import { after, before, describe, it } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { FastUploader, getBuildType } from '../src/core/upload';
import {
  backupConfig,
  restoreConfig,
  runCli,
  saveTestConfig,
} from './setup';

describe('FastUploader', () => {
  let server: http.Server;
  let baseUrl: string;
  let tempDir: string;
  let filePath: string;
  let buildChecks = 0;
  let tokenBody = '';
  let storageBody = '';
  let configBackup: string | null;

  before(async () => {
    configBackup = backupConfig();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgyer-fast-upload-'));
    filePath = path.join(tempDir, 'test-app.apk');
    fs.writeFileSync(filePath, 'fake apk bytes');

    server = http.createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        const url = new URL(request.url ?? '/', baseUrl);

        if (url.pathname === '/apiv2/app/getCOSToken') {
          tokenBody = body;
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify({
            code: 0,
            message: '',
            data: {
              key: 'upload-key',
              endpoint: `${baseUrl}/storage`,
              params: {
                key: 'apps/test/test-app.apk',
                signature: 'signature-value',
                'x-cos-security-token': 'security-token',
              },
            },
          }));
          return;
        }

        if (url.pathname === '/storage') {
          storageBody = body;
          response.statusCode = 204;
          response.end();
          return;
        }

        if (url.pathname === '/apiv2/app/buildInfo') {
          buildChecks += 1;
          response.setHeader('Content-Type', 'application/json');
          if (buildChecks === 1) {
            response.end(JSON.stringify({ code: 1247, message: 'processing' }));
          } else {
            response.end(JSON.stringify({
              code: 0,
              message: '',
              data: {
                appKey: 'app-key',
                buildKey: 'build-key',
                buildType: 2,
                buildName: 'Test App',
                buildVersion: '1.2.3',
                buildVersionNo: '12',
                buildBuildVersion: buildChecks === 2 ? 0 : 5,
                buildIdentifier: 'com.example.test',
                buildShortcutUrl: 'test-app',
              },
            }));
          }
          return;
        }

        response.statusCode = 404;
        response.end();
      });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    baseUrl = `http://127.0.0.1:${address.port}`;
    saveTestConfig({ apiKey: 'api-key', apiUrl: baseUrl });
  });

  after(async () => {
    restoreConfig(configBackup);
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('maps supported package extensions', () => {
    assert.strictEqual(getBuildType('app.ipa'), 'ios');
    assert.strictEqual(getBuildType('app.apk'), 'android');
    assert.strictEqual(getBuildType('app.hap'), 'harmony');
    assert.throws(() => getBuildType('app.zip'), /Unsupported file type/);
  });

  it('streams the package and waits for the published build', async () => {
    const statuses: string[] = [];
    const uploader = new FastUploader({ apiKey: 'api-key', apiUrl: baseUrl });
    const result = await uploader.upload({
      filePath,
      buildDescription: 'Description',
      buildUpdateDescription: 'Release notes',
      buildInstallType: 1,
      oversea: 2,
      timeoutMs: 5000,
      pollIntervalMs: 5,
      wait: true,
      onStatus: (status) => statuses.push(status),
    });

    assert.strictEqual(result.status, 'published');
    assert.strictEqual(result.uploadKey, 'upload-key');
    assert.strictEqual(result.data?.buildKey, 'build-key');
    assert.strictEqual(result.data?.buildBuildVersion, 5);
    assert.strictEqual(buildChecks, 3);
    assert.match(tokenBody, /buildType=android/);
    assert.match(tokenBody, /buildDescription=Description/);
    assert.match(tokenBody, /buildUpdateDescription=Release\+notes/);
    assert.match(tokenBody, /oversea=2/);
    assert.match(storageBody, /signature-value/);
    assert.match(storageBody, /fake apk bytes/);
    assert.deepStrictEqual(statuses.slice(0, 2), [
      'Requesting upload credentials...',
      'Uploading app package...',
    ]);
    assert.strictEqual(statuses.filter(status => status === 'Processing app package...').length, 3);
  });

  it('can return immediately after storage upload', async () => {
    const uploader = new FastUploader({ apiKey: 'api-key', apiUrl: baseUrl });
    const result = await uploader.upload({
      filePath,
      timeoutMs: 5000,
      pollIntervalMs: 5,
      wait: false,
    });

    assert.deepStrictEqual(result, { status: 'uploaded', uploadKey: 'upload-key' });
    assert.strictEqual(buildChecks, 3, 'buildInfo should not be called for no-wait uploads');
  });

  it('supports domestic no-wait uploads through the packaged CLI command', async () => {
    const hapPath = path.join(tempDir, 'test-app.hap');
    fs.writeFileSync(hapPath, 'fake hap bytes');

    const result = await runCli([
      'upload',
      hapPath,
      '--upload-region',
      'domestic',
      '--timeout',
      '5',
      '--no-wait',
      '--json',
    ], { PGYER_API_KEY: '' });

    assert.strictEqual(result.code, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.strictEqual(output.status, 'uploaded');
    assert.strictEqual(output.pending, true);
    assert.strictEqual(output.uploadKey, 'upload-key');
    assert.match(tokenBody, /buildType=harmony(&|$)/);
    assert.match(tokenBody, /oversea=2/);
    assert.match(storageBody, /fake hap bytes/);
    assert.strictEqual(buildChecks, 3, 'CLI --no-wait should skip buildInfo polling');
  });
});
