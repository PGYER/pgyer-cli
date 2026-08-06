import { after, before, describe, it } from 'node:test';
import assert from 'node:assert';
import * as http from 'http';
import {
  backupConfig,
  restoreConfig,
  runCli,
  saveTestConfig,
} from './setup';

interface SeenRequest {
  path: string;
  method: string;
  params: URLSearchParams;
}

describe('API 2.0 commands', () => {
  let backup: string | null;
  let server: http.Server;
  let baseUrl: string;
  const requests: SeenRequest[] = [];

  before(async () => {
    backup = backupConfig();
    server = http.createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        const url = new URL(request.url ?? '/', baseUrl);
        const body = Buffer.concat(chunks).toString('utf8');
        const params = request.method === 'GET'
          ? url.searchParams
          : new URLSearchParams(body);
        requests.push({ path: url.pathname, method: request.method ?? '', params });
        response.setHeader('Content-Type', 'application/json');

        const send = (data: unknown): void => {
          response.end(JSON.stringify({ code: 0, message: '', data }));
        };

        if (url.pathname === '/apiv2/app/listMy') {
          send([{
            appKey: 'app-key',
            buildKey: 'build-key',
            buildType: '2',
            buildFileSize: '1048576',
            buildName: 'Example App',
            buildVersion: '1.2.3',
            buildVersionNo: '12',
            buildBuildVersion: '5',
            buildIdentifier: 'com.example.app',
            buildIcon: 'icon',
            buildCreated: '2026-08-06 12:00:00',
          }]);
          return;
        }

        if (url.pathname === '/apiv2/app/view') {
          send({
            appKey: 'app-key',
            buildKey: params.get('buildKey') ?? 'build-key',
            buildType: '2',
            buildFileSize: '1048576',
            buildName: 'Example App',
            buildVersion: '1.2.3',
            buildVersionNo: '12',
            buildBuildVersion: '5',
            buildIdentifier: 'com.example.app',
            buildCreated: '2026-08-06 12:00:00',
            buildUpdated: '2026-08-06 12:05:00',
            buildShortcutUrl: 'example',
            buildInstallType: '2',
            buildPassword: 'existing-password',
            appIsInstallDate: '2',
            appLang: '3',
            buildVersionType: '2',
            appAutoSync: '1',
            appShowPgyerCopyright: '1',
            appExpiredDate: '',
          });
          return;
        }

        if (url.pathname === '/apiv2/app/getByShortcut') {
          send({
            buildKey: 'build-key',
            buildType: '2',
            buildFileName: 'app.apk',
            buildFileSize: '1048576',
            buildName: 'Example App',
            buildVersion: '1.2.3',
            buildVersionNo: '12',
            buildBuildVersion: '5',
            buildIdentifier: 'com.example.app',
            buildCreated: '2026-08-06 12:00:00',
            buildShortcutUrl: 'example',
          });
          return;
        }

        if (url.pathname === '/apiv2/app/update') {
          send({ appKey: 'app-key', appLang: params.get('appLang') });
          return;
        }

        if (url.pathname === '/apiv2/app/builds') {
          send({
            pageCount: 1,
            currentPage: 1,
            list: [{
              buildKey: 'build-key',
              buildType: '2',
              buildFileSize: '1048576',
              buildName: 'Example App',
              buildVersion: '1.2.3',
              buildVersionNo: '12',
              buildBuildVersion: '5',
              buildIdentifier: 'com.example.app',
              buildCreated: '2026-08-06 12:00:00',
            }],
          });
          return;
        }

        if (url.pathname === '/apiv2/app/check') {
          send({
            buildHaveNewVersion: true,
            buildVersion: '1.2.3',
            downloadURL: 'https://www.pgyer.com/apiv2/app/install?_api_key=secret',
          });
          return;
        }

        if ([
          '/apiv2/app/setNewestVersion',
          '/apiv2/app/cancelNewestVersion',
          '/apiv2/app/buildDelete',
          '/apiv2/app/deleteApp',
        ].includes(url.pathname)) {
          send({});
          return;
        }

        response.statusCode = 404;
        response.end(JSON.stringify({ code: 404, message: 'not found' }));
      });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    baseUrl = `http://127.0.0.1:${address.port}`;
    saveTestConfig({ apiKey: 'test-key', apiUrl: baseUrl });
  });

  after(async () => {
    restoreConfig(backup);
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });

  it('accepts the documented array response for apps list', async () => {
    const result = await runCli(['apps', 'list', '--json']);
    assert.strictEqual(result.code, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.strictEqual(output.apps[0].appKey, 'app-key');
  });

  it('passes buildKey when requesting a specific app version', async () => {
    const result = await runCli([
      'apps', 'info', 'app-key', '--build', 'older-build', '--json',
    ]);
    assert.strictEqual(result.code, 0, result.stderr);
    const request = requests.slice().reverse().find((item) => item.path === '/apiv2/app/view');
    assert.strictEqual(request?.params.get('buildKey'), 'older-build');
  });

  it('resolves full PGYER shortcut URLs', async () => {
    const result = await runCli([
      'apps', 'resolve', 'https://www.pgyer.com/example/', '--json',
    ]);
    assert.strictEqual(result.code, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.strictEqual(output.shortcut, 'example');
    const request = requests.slice().reverse().find((item) => item.path === '/apiv2/app/getByShortcut');
    assert.strictEqual(request?.params.get('buildShortcutUrl'), 'example');
  });

  it('merges app setting changes with current values', async () => {
    const result = await runCli([
      'apps', 'update', 'app-key', '--language', 'zh', '--json',
    ]);
    assert.strictEqual(result.code, 0, result.stderr);
    const request = requests.slice().reverse().find((item) => item.path === '/apiv2/app/update');
    assert.strictEqual(request?.params.get('appLang'), '1');
    assert.strictEqual(request?.params.get('buildInstallType'), '2');
    assert.strictEqual(request?.params.get('buildPassword'), 'existing-password');
  });

  it('lists and checks versions', async () => {
    const list = await runCli(['versions', 'list', 'app-key', '--json']);
    assert.strictEqual(list.code, 0, list.stderr);
    assert.strictEqual(JSON.parse(list.stdout).versions[0].buildKey, 'build-key');

    const check = await runCli([
      'versions', 'check', 'app-key', '--current-version', '1.0.0', '--json',
    ]);
    assert.strictEqual(check.code, 0, check.stderr);
    const checkOutput = JSON.parse(check.stdout);
    assert.strictEqual(checkOutput.buildHaveNewVersion, true);
    assert.strictEqual(checkOutput.downloadURL, undefined);
  });

  it('changes latest status and requires force for version deletion', async () => {
    const latest = await runCli(['versions', 'set-latest', 'build-key', '--json']);
    assert.strictEqual(latest.code, 0, latest.stderr);

    const unset = await runCli(['versions', 'unset-latest', 'build-key', '--json']);
    assert.strictEqual(unset.code, 0, unset.stderr);
    assert.ok(requests.some((item) => item.path === '/apiv2/app/cancelNewestVersion'));

    const refused = await runCli(['versions', 'delete', 'build-key', '--json']);
    assert.notStrictEqual(refused.code, 0);
    assert.match(refused.stderr, /--force/);

    const deleted = await runCli([
      'versions', 'delete', 'build-key', '--force', '--json',
    ]);
    assert.strictEqual(deleted.code, 0, deleted.stderr);
  });

  it('calls the app deletion endpoint only with force', async () => {
    const refused = await runCli(['apps', 'delete', 'app-key', '--json']);
    assert.notStrictEqual(refused.code, 0);
    assert.match(refused.stderr, /--force/);

    const deleted = await runCli([
      'apps', 'delete', 'app-key', '--force', '--json',
    ]);
    assert.strictEqual(deleted.code, 0, deleted.stderr);
    const request = requests.slice().reverse().find((item) => item.path === '/apiv2/app/deleteApp');
    assert.strictEqual(request?.params.get('appKey'), 'app-key');
  });
});
