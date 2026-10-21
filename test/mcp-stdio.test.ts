import { after, before, describe, it } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { ok, startFakeServer, type FakeServer } from './fake-pgyer';

const CLI = path.resolve(__dirname, '../src/index.ts');
const API_KEY = 'stdio-test-key-0123456789';

describe('pgyer mcp over stdio', () => {
  let fake: FakeServer;
  let home: string;
  let env: Record<string, string>;

  before(async () => {
    fake = await startFakeServer((request, response) => {
      if (request.path === '/apiv2/app/listMy') {
        ok(response, { list: [{ appKey: 'app-1', buildKey: 'build-1', buildType: '2', buildName: 'Stdio App', buildShortcutUrl: 'stdio' }], count: '1', pageCount: 1, page: 1 });
        return;
      }
      response.statusCode = 404;
      response.end();
    });
    // The saved login is used when PGYER_API_KEY is not set.
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'pgyer-mcp-home-'));
    fs.mkdirSync(path.join(home, '.config', 'pgyer'), { recursive: true });
    fs.writeFileSync(
      path.join(home, '.config', 'pgyer', 'config.json'),
      JSON.stringify({ apiKey: API_KEY, apiUrl: fake.baseUrl })
    );
    env = { ...process.env, HOME: home, USERPROFILE: home, PGYER_API_KEY: '' } as Record<string, string>;
  });

  after(async () => {
    await fake.close();
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('writes nothing but JSON-RPC messages to stdout', async () => {
    const child = spawn(process.execPath, ['--import', 'tsx', CLI, 'mcp'], { env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    const responses = new Map<number, Record<string, any>>();
    const waitFor = (id: number): Promise<Record<string, any>> => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no response ${id}; stderr: ${stderr}`)), 15_000);
      const check = (): void => {
        for (const line of stdout.split('\n').filter(Boolean)) {
          const message = JSON.parse(line);
          if (message.id !== undefined) responses.set(message.id, message);
        }
        if (responses.has(id)) {
          clearTimeout(timer);
          child.stdout.off('data', check);
          resolve(responses.get(id)!);
        }
      };
      child.stdout.on('data', check);
      check();
    });
    const send = (message: object): void => {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
    };

    send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'raw', version: '1' } } });
    const init = await waitFor(1);
    assert.strictEqual(init.result.serverInfo.name, 'pgyer');
    send({ method: 'notifications/initialized' });
    send({ id: 2, method: 'tools/list' });
    const list = await waitFor(2);
    assert.strictEqual(list.result.tools.length, 7);
    send({ id: 3, method: 'tools/call', params: { name: 'list_apps', arguments: {} } });
    const call = await waitFor(3);
    assert.strictEqual(call.result.structuredContent.apps[0].downloadPageUrl, 'https://www.pgyer.com/stdio');

    child.stdin.end();
    const code = await new Promise<number | null>((resolve) => child.on('close', resolve));
    assert.strictEqual(code, 0, stderr);

    for (const line of stdout.split('\n').filter(Boolean)) {
      const message = JSON.parse(line);
      assert.strictEqual(message.jsonrpc, '2.0', line);
    }
    assert.ok(stdout.endsWith('\n'));
    assert.ok(!stdout.includes(API_KEY) && !stderr.includes(API_KEY));

    const request = fake.requests.at(-1)!;
    assert.strictEqual(request.form.get('_api_key'), API_KEY, 'uses the key saved by pgyer auth login');
    assert.match(String(request.headers['user-agent']), /^pgyer-mcp-server\/\d+\.\d+\.\d+ pgyer-cli\/\d+\.\d+\.\d+ Node\/v\d+/);
  });

  for (const [era, mode] of [
    ['2025-11-25', undefined],
    ['2026-07-28', { pin: '2026-07-28' }],
  ] as const) {
    it(`serves SDK stdio clients on protocol ${era} and prefers PGYER_API_KEY`, async () => {
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: ['--import', 'tsx', CLI, 'mcp'],
        env: { ...env, PGYER_API_KEY: 'env-key-0123456789' },
        stderr: 'pipe',
      });
      const client = new Client(
        { name: 'stdio-test', version: '1.0.0' },
        mode ? { versionNegotiation: { mode } } : undefined
      );
      await client.connect(transport);
      try {
        assert.strictEqual(client.getNegotiatedProtocolVersion(), era);
        const result = await client.callTool({ name: 'list_apps', arguments: { page: 1 } });
        assert.ok(!result.isError, JSON.stringify(result.content));
        assert.strictEqual((result.structuredContent as { apps: { appKey: string }[] }).apps[0].appKey, 'app-1');
        assert.strictEqual(fake.requests.at(-1)?.form.get('_api_key'), 'env-key-0123456789');
      } finally {
        await client.close();
      }
    });
  }
});
