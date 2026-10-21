import { after, before, describe, it } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createPgyerMcpServer, type PgyerMcpServerOptions } from '../src/mcp/server';
import { CLI_VERSION } from '../src/core/version';
import { buildInfo, ok, sendJson, startFakeServer, uploadHandler, type FakeServer } from './fake-pgyer';

const API_KEY = 'mcp-test-key-0123456789';

type ToolResult = Awaited<ReturnType<Client['callTool']>>;

function textOf(result: ToolResult): string {
  return (result.content as { type: string; text?: string }[])
    .map((item) => item.text ?? '')
    .join('\n');
}

function structured<T = Record<string, any>>(result: ToolResult): T {
  assert.ok(!result.isError, `tool failed: ${textOf(result)}`);
  return result.structuredContent as T;
}

async function connect(options: PgyerMcpServerOptions): Promise<Client> {
  const server = createPgyerMcpServer(options);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'pgyer-test', version: '1.0.0' });
  await client.connect(clientTransport);
  return client;
}

describe('pgyer MCP server', () => {
  let fake: FakeServer;
  let client: Client;
  let tempDir: string;
  let apkPath: string;
  let buildInfoCodes: number[] = [];
  let tokenError: number | undefined;

  before(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgyer-mcp-'));
    apkPath = path.join(tempDir, 'Demo App.apk');
    fs.writeFileSync(apkPath, Buffer.alloc(1024 * 1024, 1));

    let baseUrl = '';
    const upload = uploadHandler(() => baseUrl);
    const app = (overrides: Record<string, unknown>) => ({
      buildKey: 'other-build',
      buildType: '1',
      buildName: 'Other',
      buildVersion: '2.0',
      buildBuildVersion: '3',
      buildIdentifier: 'com.example.other',
      buildShortcutUrl: 'other',
      buildCreated: '2026-10-20 10:00:00',
      buildPassword: 'list-password',
      appKey: 'other-app',
      ...overrides,
    });

    fake = await startFakeServer((request, response) => {
      const form = request.form;
      switch (request.path) {
        case '/apiv2/app/getCOSToken':
          if (tokenError) {
            sendJson(response, { code: tokenError, message: 'Upload refused' });
            return;
          }
          upload(request, response);
          return;
        case '/apiv2/app/buildInfo': {
          const code = buildInfoCodes.shift();
          if (code) sendJson(response, { code, message: 'processing' });
          else ok(response, buildInfo());
          return;
        }
        case '/apiv2/app/listMy':
          ok(response, form.get('page') === '2'
            ? { list: [app({ appKey: 'demo-app', buildKey: 'build-key', buildType: '2', buildName: 'Demo App', buildShortcutUrl: 'Demo' })], count: '2', pageCount: 2, page: 2 }
            : { list: [app({})], count: '2', pageCount: 2, page: 1 });
          return;
        case '/apiv2/app/getByShortcut':
          if (form.get('buildShortcutUrl') !== 'demo') {
            sendJson(response, { code: 1216, message: 'App not found' });
            return;
          }
          ok(response, {
            buildKey: 'build-key',
            buildType: '2',
            buildName: 'Demo App',
            buildVersion: '1.2.3',
            buildIdentifier: 'com.example.demo',
            buildShortcutUrl: 'demo',
            buildFileName: 'demo.apk',
            downloadURL: 'https://cos.example.com/demo.apk?sign=secret',
          });
          return;
        case '/apiv2/app/view':
          ok(response, {
            ...buildInfo({ buildKey: form.get('buildKey') ?? 'build-key' }),
            appKey: form.get('appKey'),
            buildIsLastest: '1',
            buildInstallType: '2',
            buildPassword: 'secret-install-password',
            appIsInstallDate: '1',
            appInstallStartDate: '2026-10-01',
            appInstallEndDate: '2026-12-31',
            appLang: '3',
            buildVersionType: '1',
            appAutoSync: '1',
            appShowPgyerCopyright: '2',
            iconUrl: 'https://cdn.example.com/icon.png',
          });
          return;
        case '/apiv2/app/builds':
          ok(response, {
            pageCount: 3,
            currentPage: Number(form.get('page')),
            list: [
              { buildKey: 'build-key', buildVersion: '1.2.3', buildVersionNo: '45', buildBuildVersion: '7', buildIsLastest: '1', buildCreated: '2026-10-21 12:00:00', buildFileName: 'demo.apk', buildFileSize: '14' },
              { buildKey: 'old-build', buildVersion: '1.2.2', buildVersionNo: '44', buildBuildVersion: '6', buildIsLastest: '2', buildCreated: '2026-10-20 12:00:00' },
            ],
          });
          return;
        case '/apiv2/app/setNewestVersion':
        case '/apiv2/app/cancelNewestVersion':
        case '/apiv2/app/update':
          ok(response, {});
          return;
        default:
          upload(request, response);
      }
    });
    baseUrl = fake.baseUrl;
    client = await connect({
      loadConfig: () => ({ apiKey: API_KEY, apiUrl: baseUrl }),
      pollIntervalMs: 5,
    });
  });

  after(async () => {
    await client.close();
    await fake.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('identifies itself and lists the tools with annotations and output schemas', async () => {
    assert.deepStrictEqual(client.getServerVersion()?.name, 'pgyer');
    assert.strictEqual(client.getServerVersion()?.version, CLI_VERSION);
    assert.match(client.getInstructions() ?? '', /download page/);

    const { tools } = await client.listTools();
    const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
    assert.deepStrictEqual(Object.keys(byName).sort(), [
      'get_app',
      'get_upload_status',
      'list_apps',
      'list_versions',
      'set_latest_version',
      'update_app_settings',
      'upload_app',
    ]);
    const hints = (name: string) => {
      const { readOnlyHint, destructiveHint, idempotentHint, openWorldHint } = byName[name].annotations ?? {};
      return { readOnlyHint, destructiveHint, idempotentHint, openWorldHint };
    };
    assert.deepStrictEqual(hints('upload_app'), { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true });
    for (const name of ['get_upload_status', 'list_apps', 'get_app', 'list_versions']) {
      assert.deepStrictEqual(hints(name), { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }, name);
    }
    for (const name of ['set_latest_version', 'update_app_settings']) {
      assert.deepStrictEqual(hints(name), { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true }, name);
    }
    for (const tool of tools) {
      assert.ok(tool.outputSchema, `${tool.name} has an output schema`);
      assert.ok((tool.description ?? '').length > 60, `${tool.name} has a useful description`);
    }
    assert.deepStrictEqual(
      Object.keys((byName.upload_app.inputSchema as { properties: object }).properties).sort(),
      ['channelShortcut', 'description', 'filePath', 'installEndDate', 'installStartDate', 'installType', 'oversea', 'password', 'processingTimeoutSeconds', 'updateDescription']
    );
  });

  it('lists apps without passwords and names itself in the User-Agent', async () => {
    const before = fake.requests.length;
    const result = await client.callTool({ name: 'list_apps', arguments: { page: 1 } });
    const output = structured(result);
    assert.strictEqual(output.page, 1);
    assert.strictEqual(output.pageCount, 2);
    assert.strictEqual(output.totalApps, 2);
    assert.deepStrictEqual(output.apps[0], {
      appKey: 'other-app',
      name: 'Other',
      platform: 'iOS',
      version: '2.0',
      buildNumber: '3',
      identifier: 'com.example.other',
      shortcut: 'other',
      downloadPageUrl: 'https://www.pgyer.com/other',
      latestBuildKey: 'other-build',
      lastUploadAt: '2026-10-20 10:00:00',
    });
    assert.ok(!textOf(result).includes('list-password'));

    const request = fake.requests[before];
    assert.strictEqual(request.path, '/apiv2/app/listMy');
    assert.strictEqual(request.form.get('_api_key'), API_KEY);
    assert.ok(!request.url.includes(API_KEY));
    const agent = String(request.headers['user-agent']);
    assert.ok(
      agent.startsWith(`pgyer-mcp-server/${CLI_VERSION} pgyer-cli/${CLI_VERSION} Node/v`),
      agent
    );
  });

  it('gets an app by appKey without its install password', async () => {
    const result = await client.callTool({ name: 'get_app', arguments: { appKey: 'demo-app' } });
    const app = structured(result);
    assert.strictEqual(app.appKey, 'demo-app');
    assert.strictEqual(app.downloadPageUrl, 'https://www.pgyer.com/demo');
    assert.strictEqual(app.qrCodeUrl, 'https://www.pgyer.com/app/qrcodeHistory/abc');
    assert.strictEqual(app.installType, 'password');
    assert.deepStrictEqual(app.installPeriod, { start: '2026-10-01', end: '2026-12-31' });
    assert.strictEqual(app.language, 'auto');
    assert.strictEqual(app.versionSource, 'pgyer');
    assert.strictEqual(app.autoSync, true);
    assert.strictEqual(app.showPgyerCopyright, false);
    assert.strictEqual(app.isLatest, true);
    assert.ok(!JSON.stringify(result).includes('secret-install-password'));
  });

  it('gets an app by shortcut URL, finding its appKey in the app list', async () => {
    const result = await client.callTool({ name: 'get_app', arguments: { shortcut: 'https://www.pgyer.com/demo' } });
    const app = structured(result);
    assert.strictEqual(app.appKey, 'demo-app');
    assert.strictEqual(app.buildKey, 'build-key');
    assert.strictEqual(app.fileName, 'demo.apk');
    assert.ok(!JSON.stringify(result).includes('sign=secret'), 'the signed file URL is not returned');
    const view = fake.requests.filter((request) => request.path === '/apiv2/app/view').at(-1);
    assert.strictEqual(view?.form.get('appKey'), 'demo-app');
    assert.strictEqual(view?.form.get('buildKey'), 'build-key');
  });

  it('reports unknown shortcuts and bad argument combinations as tool errors', async () => {
    let result = await client.callTool({ name: 'get_app', arguments: { shortcut: 'missing' } });
    assert.strictEqual(result.isError, true);
    assert.match(textOf(result), /PGYER API error 1216: App not found/);

    result = await client.callTool({ name: 'get_app', arguments: { appKey: 'a', shortcut: 'b' } });
    assert.strictEqual(result.isError, true);
    assert.match(textOf(result), /either appKey or shortcut/);

    result = await client.callTool({ name: 'get_app', arguments: {} });
    assert.strictEqual(result.isError, true);
  });

  it('lists versions by shortcut', async () => {
    const result = await client.callTool({ name: 'list_versions', arguments: { shortcut: 'demo', page: 2 } });
    const output = structured(result);
    assert.strictEqual(output.appKey, 'demo-app');
    assert.strictEqual(output.page, 2);
    assert.strictEqual(output.pageCount, 3);
    assert.deepStrictEqual(output.versions.map((item: { buildKey: string; isLatest: boolean }) => [item.buildKey, item.isLatest]), [
      ['build-key', true],
      ['old-build', false],
    ]);
    const builds = fake.requests.filter((request) => request.path === '/apiv2/app/builds').at(-1);
    assert.strictEqual(builds?.form.get('appKey'), 'demo-app');
    assert.strictEqual(builds?.form.get('page'), '2');
  });

  it('sets and cancels the latest version', async () => {
    let result = await client.callTool({ name: 'set_latest_version', arguments: { buildKey: 'old-build' } });
    assert.deepStrictEqual(structured(result), { buildKey: 'old-build', latest: true });
    assert.strictEqual(fake.requests.at(-1)?.path, '/apiv2/app/setNewestVersion');
    assert.strictEqual(fake.requests.at(-1)?.form.get('buildKey'), 'old-build');

    result = await client.callTool({ name: 'set_latest_version', arguments: { buildKey: 'old-build', latest: false } });
    assert.deepStrictEqual(structured(result), { buildKey: 'old-build', latest: false });
    assert.strictEqual(fake.requests.at(-1)?.path, '/apiv2/app/cancelNewestVersion');
  });

  it('merges app setting changes with the current settings', async () => {
    const before = fake.requests.length;
    let result = await client.callTool({
      name: 'update_app_settings',
      arguments: { appKey: 'demo-app', language: 'zh', showPgyerCopyright: true, dryRun: true },
    });
    assert.deepStrictEqual(structured(result), { appKey: 'demo-app', updated: ['language', 'copyright'], dryRun: true });
    assert.ok(!fake.requests.slice(before).some((request) => request.path === '/apiv2/app/update'));

    result = await client.callTool({
      name: 'update_app_settings',
      arguments: { appKey: 'demo-app', language: 'zh' },
    });
    assert.deepStrictEqual(structured(result), { appKey: 'demo-app', updated: ['language'], dryRun: false });
    const update = fake.requests.at(-1)!;
    assert.strictEqual(update.path, '/apiv2/app/update');
    assert.strictEqual(update.form.get('appLang'), '1');
    assert.strictEqual(update.form.get('buildInstallType'), '2');
    assert.strictEqual(update.form.get('buildPassword'), 'secret-install-password');
    assert.strictEqual(update.form.get('appShowPgyerCopyright'), '2');
    assert.ok(!textOf(result).includes('secret-install-password'));

    result = await client.callTool({ name: 'update_app_settings', arguments: { appKey: 'demo-app' } });
    assert.strictEqual(result.isError, true);
    result = await client.callTool({
      name: 'update_app_settings',
      arguments: { appKey: 'demo-app', installType: 'public', password: 'x' },
    });
    assert.strictEqual(result.isError, true);
    assert.match(textOf(result), /password can only be set together with password installation/i);
  });

  it('uploads an app with progress notifications', async () => {
    buildInfoCodes = [1247, 1246];
    const progress: { progress: number; total?: number; message?: string }[] = [];
    const result = await client.callTool(
      {
        name: 'upload_app',
        arguments: {
          filePath: apkPath,
          updateDescription: 'MCP release notes',
          password: 'pw',
          oversea: false,
          installStartDate: '2026-11-01',
          installEndDate: '2026-11-30',
          channelShortcut: 'beta',
        },
      },
      { onprogress: (event) => progress.push(event) }
    );
    const build = structured(result);
    assert.deepStrictEqual(build, {
      status: 'published',
      buildKey: 'build-key',
      appName: 'Demo App',
      platform: 'Android',
      version: '1.2.3',
      versionCode: '45',
      buildNumber: '7',
      identifier: 'com.example.demo',
      shortcut: 'demo',
      downloadPageUrl: 'https://www.pgyer.com/demo',
      qrCodeUrl: 'https://www.pgyer.com/app/qrcodeHistory/abc',
      fileName: 'demo.apk',
      fileSize: 14,
      createdAt: '2026-10-21 12:00:00',
      updateDescription: 'Release notes',
    });
    assert.match(textOf(result), /Download page: https:\/\/www\.pgyer\.com\/demo/);

    const token = fake.requests.filter((request) => request.path === '/apiv2/app/getCOSToken').at(-1)!;
    assert.deepStrictEqual(Object.fromEntries(token.form), {
      _api_key: API_KEY,
      buildType: 'android',
      buildInstallType: '2',
      buildPassword: 'pw',
      buildUpdateDescription: 'MCP release notes',
      buildInstallDate: '1',
      buildInstallStartDate: '2026-11-01',
      buildInstallEndDate: '2026-11-30',
      buildChannelShortcut: 'beta',
      oversea: '2',
    });
    const storage = fake.requests.filter((request) => request.path === '/storage').at(-1)!;
    assert.match(String(storage.headers['user-agent']), /^pgyer-mcp-server\//);

    assert.ok(progress.length >= 7, `got ${progress.length} progress notifications`);
    assert.ok(progress.every((event) => event.total === 100));
    for (let index = 1; index < progress.length; index += 1) {
      assert.ok(progress[index].progress > progress[index - 1].progress, 'progress increases');
    }
    assert.strictEqual(progress[0].progress, 1);
    assert.ok(progress.some((event) => /^Uploading Demo App\.apk: 100%/.test(event.message ?? '')));
    assert.ok(progress.some((event) => /Waiting for PGYER to process/.test(event.message ?? '')));
    assert.strictEqual(progress.at(-1)?.progress, 100);
    assert.ok(!JSON.stringify(progress).includes('secret'));
  });

  it('returns status "processing" after the timeout, then get_upload_status finds the build', async () => {
    buildInfoCodes = Array(400).fill(1247);
    const result = await client.callTool({
      name: 'upload_app',
      arguments: { filePath: apkPath, processingTimeoutSeconds: 1 },
    });
    assert.deepStrictEqual(structured(result), { status: 'processing', buildKey: 'upload-key' });
    assert.match(textOf(result), /get_upload_status/);

    buildInfoCodes = [1247];
    let status = await client.callTool({ name: 'get_upload_status', arguments: { buildKey: 'upload-key' } });
    assert.deepStrictEqual(structured(status), { status: 'processing', buildKey: 'upload-key' });

    status = await client.callTool({ name: 'get_upload_status', arguments: { buildKey: 'upload-key' } });
    assert.strictEqual(structured(status).status, 'published');
    assert.strictEqual(structured(status).downloadPageUrl, 'https://www.pgyer.com/demo');

    buildInfoCodes = [1247, 1247];
    status = await client.callTool({ name: 'get_upload_status', arguments: { buildKey: 'upload-key', waitSeconds: 5 } });
    assert.strictEqual(structured(status).status, 'published');
    buildInfoCodes = [];
  });

  it('returns API errors with the PGYER hint', async () => {
    tokenError = 1019;
    try {
      const result = await client.callTool({ name: 'upload_app', arguments: { filePath: apkPath } });
      assert.strictEqual(result.isError, true);
      assert.strictEqual(
        textOf(result),
        'PGYER API error 1019: Upload refused\nComplete real-name verification before uploading: https://www.pgyer.com/account/certification'
      );
    } finally {
      tokenError = undefined;
    }
  });

  it('validates upload arguments', async () => {
    let result = await client.callTool({
      name: 'upload_app',
      arguments: { filePath: apkPath, installStartDate: '2026-11-01' },
    });
    assert.strictEqual(result.isError, true);
    assert.match(textOf(result), /both installStartDate and installEndDate/);

    result = await client.callTool({ name: 'upload_app', arguments: { filePath: path.join(tempDir, 'missing.apk') } });
    assert.strictEqual(result.isError, true);
    assert.match(textOf(result), /^File not found: /);

    result = await client.callTool({ name: 'upload_app', arguments: { filePath: path.join(tempDir, 'notes.txt') } });
    assert.strictEqual(result.isError, true);
    assert.match(textOf(result), /Unsupported file type/);
  });
});

describe('pgyer MCP server without an API key', () => {
  it('starts and explains how to configure the key', async () => {
    const client = await connect({ loadConfig: () => ({}) });
    try {
      const { tools } = await client.listTools();
      assert.strictEqual(tools.length, 7);
      const result = await client.callTool({ name: 'list_apps', arguments: {} });
      assert.strictEqual(result.isError, true);
      assert.match(textOf(result), /PGYER_API_KEY/);
      assert.match(textOf(result), /pgyer auth login/);
    } finally {
      await client.close();
    }
  });
});
