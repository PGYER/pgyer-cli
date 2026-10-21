import { after, before, describe, it } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ApiClient, ApiError, errorHint, NetworkError } from '../src/core/api';
import { DEFAULT_API_SERVERS, getApiServers } from '../src/core/config';
import {
  FastUploader,
  ProcessingTimeoutError,
  buildTokenForm,
  getBuildType,
} from '../src/core/upload';
import { CLI_USER_AGENT, CLI_VERSION } from '../src/core/version';
import {
  deadServerUrl,
  multipartParts,
  ok,
  sendJson,
  startFakeServer,
  uploadHandler,
  type FakeServer,
} from './fake-pgyer';
import { backupConfig, restoreConfig, runCli, saveTestConfig } from './setup';

const API_KEY = 'test-api-key-0123456789';

let tempDir: string;
let apkPath: string;

function writeFile(name: string, content = 'fake package'): string {
  const filePath = path.join(tempDir, name);
  fs.writeFileSync(filePath, content);
  return filePath;
}

/** Starts a fake PGYER that serves all three upload steps. */
async function uploadServer(options: Parameters<typeof uploadHandler>[1] = {}): Promise<FakeServer> {
  let baseUrl = '';
  const fake = await startFakeServer(uploadHandler(() => baseUrl, options));
  baseUrl = fake.baseUrl;
  return fake;
}

function uploader(servers: string[], userAgent?: string): FastUploader {
  return new FastUploader({ apiKey: API_KEY }, { servers, userAgent });
}

before(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgyer-upload-behaviour-'));
  apkPath = writeFile('demo.apk', 'fake apk bytes');
});

after(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('Upload token form (matches the Jenkins plugin)', () => {
  it('detects the build type from the extension', () => {
    assert.strictEqual(getBuildType('a.apk'), 'android');
    assert.strictEqual(getBuildType('a.IPA'), 'ios');
    assert.strictEqual(getBuildType('a.hap'), 'harmony');
    assert.throws(() => getBuildType('a.aab'), /Unsupported file type/);
  });

  it('sends only the build type when nothing else is set', () => {
    assert.deepStrictEqual(buildTokenForm('android', {}), { buildType: 'android' });
    assert.deepStrictEqual(
      buildTokenForm('ios', { buildDescription: '  ', buildUpdateDescription: '', buildChannelShortcut: '' }),
      { buildType: 'ios' }
    );
  });

  it('treats a password on its own as password installation', () => {
    assert.deepStrictEqual(buildTokenForm('android', { buildPassword: 'pw' }), {
      buildType: 'android',
      buildInstallType: '2',
      buildPassword: 'pw',
    });
    assert.strictEqual(buildTokenForm('android', { buildInstallType: 3 }).buildInstallType, '3');
  });

  it('maps oversea and the install period', () => {
    assert.strictEqual(buildTokenForm('android', { oversea: 1 }).oversea, '1');
    assert.strictEqual(buildTokenForm('android', { oversea: 2 }).oversea, '2');
    assert.strictEqual(buildTokenForm('android', {}).oversea, undefined);
    assert.deepStrictEqual(
      buildTokenForm('android', { buildInstallStartDate: '2026-01-01', buildInstallEndDate: '2026-02-01' }),
      {
        buildType: 'android',
        buildInstallDate: '1',
        buildInstallStartDate: '2026-01-01',
        buildInstallEndDate: '2026-02-01',
      }
    );
    assert.strictEqual(
      buildTokenForm('android', { buildInstallStartDate: '2026-01-01' }).buildInstallDate,
      undefined,
      'one date alone is not sent'
    );
  });
});

describe('Fast upload requests', () => {
  it('keeps the API key out of URLs, sends a User-Agent and forwards every token field', async () => {
    const fake = await uploadServer({
      buildInfoCodes: [1246, 1247],
      tokenParams: {
        key: 'apps/upload-key.apk',
        signature: 'secret-signature',
        'x-cos-security-token': 'secret-security-token',
        'x-cos-meta-extra': 'kept',
      },
    });
    try {
      const statuses: string[] = [];
      const result = await uploader([fake.baseUrl]).upload({
        filePath: apkPath,
        buildUpdateDescription: 'Notes',
        pollIntervalMs: 5,
        onStatus: (status) => statuses.push(status),
      });
      assert.strictEqual(result.status, 'published');
      assert.strictEqual(result.data?.buildShortcutUrl, 'demo');

      for (const request of fake.requests) {
        assert.ok(!request.url.includes(API_KEY), `${request.path} must not carry the key in its URL`);
        assert.ok(!request.url.includes('_api_key'), `${request.path} must not carry _api_key in its URL`);
        assert.strictEqual(request.method, 'POST');
        assert.strictEqual(request.headers['user-agent'], CLI_USER_AGENT);
      }
      assert.match(CLI_USER_AGENT, new RegExp(`^pgyer-cli/${CLI_VERSION.replace(/\./g, '\\.')} Node/v\\d+`));

      const token = fake.requests.find((request) => request.path === '/apiv2/app/getCOSToken');
      assert.deepStrictEqual(Object.fromEntries(token!.form), {
        _api_key: API_KEY,
        buildType: 'android',
        buildUpdateDescription: 'Notes',
      });

      const polls = fake.requests.filter((request) => request.path === '/apiv2/app/buildInfo');
      assert.strictEqual(polls.length, 3, '1246 and 1247 both mean processing');
      assert.strictEqual(polls[0].form.get('_api_key'), API_KEY);
      assert.strictEqual(polls[0].form.get('buildKey'), 'upload-key');

      const storage = fake.requests.find((request) => request.path === '/storage');
      const parts = multipartParts(storage!);
      assert.deepStrictEqual(parts.map((part) => part.name), [
        'key',
        'signature',
        'x-cos-security-token',
        'x-cos-meta-extra',
        'x-cos-meta-file-name',
        'file',
      ]);
      assert.strictEqual(parts.find((part) => part.name === 'x-cos-meta-file-name')?.value, 'demo.apk');
      assert.strictEqual(parts.find((part) => part.name === 'file')?.filename, 'demo.apk');
      assert.strictEqual(parts.find((part) => part.name === 'file')?.value, 'fake apk bytes');
      assert.strictEqual(Number(storage!.headers['content-length']), storage!.body.length);
      assert.ok(!statuses.join('\n').includes('secret'), 'status messages never include credentials');
    } finally {
      await fake.close();
    }
  });

  it('leaves out x-cos-meta-file-name for names that are not plain ASCII', async () => {
    const fake = await uploadServer();
    try {
      const filePath = writeFile('测试 app.apk');
      await uploader([fake.baseUrl]).upload({ filePath, pollIntervalMs: 5 });
      const parts = multipartParts(fake.requests.find((request) => request.path === '/storage')!);
      assert.ok(!parts.some((part) => part.name === 'x-cos-meta-file-name'));
      assert.strictEqual(parts.find((part) => part.name === 'file')?.filename, 'upload.apk');
    } finally {
      await fake.close();
    }
  });

  it('accepts any 2xx answer from storage and reports upload progress', async () => {
    const fake = await uploadServer({ storageStatus: 200, storageBody: '<ok/>' });
    try {
      const sent: number[] = [];
      const result = await uploader([fake.baseUrl], 'custom-agent/1').upload({
        filePath: apkPath,
        pollIntervalMs: 5,
        onProgress: (progress) => {
          if (progress.stage === 'upload') sent.push(progress.sentBytes);
        },
      });
      assert.strictEqual(result.status, 'published');
      assert.strictEqual(sent.at(-1), fs.statSync(apkPath).size);
      assert.ok(fake.requests.every((request) => request.headers['user-agent'] === 'custom-agent/1'));
    } finally {
      await fake.close();
    }
  });

  it('reports storage errors without echoing the response body', async () => {
    const fake = await uploadServer({
      storageStatus: 403,
      storageBody:
        '<Error><Code>AccessDenied</Code><Message>Request has expired</Message>' +
        '<RequestId>req-1</RequestId><StringToSign>secret-signature</StringToSign></Error>',
    });
    try {
      await assert.rejects(
        uploader([fake.baseUrl]).upload({ filePath: apkPath, pollIntervalMs: 5 }),
        (error: Error) => {
          assert.strictEqual(
            error.message,
            'Uploading the file to storage failed with HTTP 403: AccessDenied: Request has expired (request ID req-1)'
          );
          return true;
        }
      );
    } finally {
      await fake.close();
    }
  });

  it('keeps polling through network errors and non-JSON answers', async () => {
    const fake = await uploadServer({ buildInfoCodes: ['html', 1247, 'html'] });
    try {
      const statuses: string[] = [];
      const result = await uploader([fake.baseUrl]).upload({
        filePath: apkPath,
        pollIntervalMs: 5,
        onStatus: (status) => statuses.push(status),
      });
      assert.strictEqual(result.status, 'published');
      assert.strictEqual(fake.requests.filter((request) => request.path === '/apiv2/app/buildInfo').length, 4);
      assert.strictEqual(statuses.filter((status) => status.startsWith('Checking the build status failed')).length, 1);
    } finally {
      await fake.close();
    }
  });

  it('stops polling on a JSON API error', async () => {
    const fake = await uploadServer({ buildInfoCodes: [1247, 1035] });
    try {
      await assert.rejects(
        uploader([fake.baseUrl]).upload({ filePath: apkPath, pollIntervalMs: 5 }),
        (error: unknown) => error instanceof ApiError && error.code === 1035
      );
      assert.strictEqual(fake.requests.filter((request) => request.path === '/apiv2/app/buildInfo').length, 2);
    } finally {
      await fake.close();
    }
  });

  it('gives up after the processing deadline with the build key', async () => {
    const fake = await uploadServer({ buildInfoCodes: Array(1000).fill(1247) });
    try {
      await assert.rejects(
        uploader([fake.baseUrl]).upload({ filePath: apkPath, timeoutMs: 60, pollIntervalMs: 5 }),
        (error: unknown) => {
          assert.ok(error instanceof ProcessingTimeoutError);
          assert.strictEqual(error.buildKey, 'upload-key');
          assert.match(error.message, /^PGYER is still processing the build after 0 seconds\. It may still be published; check your PGYER app list\. Build key: upload-key$/);
          return true;
        }
      );
    } finally {
      await fake.close();
    }
  });
});

describe('API server fallback', () => {
  it('uses www.pgyer.com, then xcxwo.com, then pgyerapp.com unless an API URL is configured', () => {
    assert.deepStrictEqual(DEFAULT_API_SERVERS, [
      'https://www.pgyer.com',
      'https://www.xcxwo.com',
      'https://www.pgyerapp.com',
    ]);
    assert.deepStrictEqual(getApiServers({}), DEFAULT_API_SERVERS);
    assert.deepStrictEqual(getApiServers({ apiUrl: 'https://pgyer.example.com/' }), ['https://pgyer.example.com']);
    assert.deepStrictEqual(new ApiClient({ apiUrl: 'https://pgyer.example.com' }).servers, ['https://pgyer.example.com']);
  });

  it('moves on after network errors and non-JSON answers, and polls the server that worked', async () => {
    const dead = await deadServerUrl();
    const html = await startFakeServer((_request, response) => {
      response.setHeader('Content-Type', 'text/html');
      response.end('<html>captive portal</html>');
    });
    const good = await uploadServer({ buildInfoCodes: [1247] });
    try {
      const result = await uploader([dead, html.baseUrl, good.baseUrl]).upload({ filePath: apkPath, pollIntervalMs: 5 });
      assert.strictEqual(result.status, 'published');
      assert.deepStrictEqual(html.requests.map((request) => request.path), ['/apiv2/app/getCOSToken']);
      assert.ok(good.requests.some((request) => request.path === '/apiv2/app/buildInfo'));
    } finally {
      await html.close();
      await good.close();
    }
  });

  it('stops at the first JSON API error', async () => {
    const failing = await startFakeServer((_request, response) => sendJson(response, { code: 1022, message: 'Storage is full' }));
    const good = await uploadServer();
    try {
      await assert.rejects(
        uploader([failing.baseUrl, good.baseUrl]).upload({ filePath: apkPath }),
        (error: unknown) => {
          assert.ok(error instanceof ApiError);
          assert.strictEqual(error.code, 1022);
          assert.strictEqual(error.message, 'Storage is full');
          assert.strictEqual(
            error.hint,
            'Your PGYER storage is full or the file is too large. Free up space or upgrade your plan.'
          );
          return true;
        }
      );
      assert.strictEqual(good.requests.length, 0);
    } finally {
      await failing.close();
      await good.close();
    }
  });

  it('reports every server when none can be reached', async () => {
    const first = await deadServerUrl();
    const second = await deadServerUrl();
    const api = new ApiClient({ apiKey: API_KEY }, { servers: [first, second] });
    await assert.rejects(
      api.request({ path: '/apiv2/app/listMy' }),
      (error: unknown) => error instanceof NetworkError &&
        error.message.startsWith(`None of the PGYER API servers could be reached: ${first}, ${second}.`)
    );
  });

  it('remembers the server that answered', async () => {
    const dead = await deadServerUrl();
    const good = await startFakeServer((_request, response) => ok(response, { list: [] }));
    try {
      const api = new ApiClient({ apiKey: API_KEY }, { servers: [dead, good.baseUrl] });
      await api.request({ path: '/apiv2/app/listMy' });
      await api.request({ path: '/apiv2/app/listMy' });
      assert.strictEqual(good.requests.length, 2);
    } finally {
      await good.close();
    }
  });
});

describe('Error hints', () => {
  it('uses the Jenkins plugin texts', () => {
    const apiKeyHint = 'Check that the API key is correct. You can find it at https://www.pgyer.com/account/api';
    assert.strictEqual(errorHint(1001), apiKeyHint);
    assert.strictEqual(errorHint(1002), apiKeyHint);
    assert.strictEqual(errorHint(1003), 'Sub-accounts cannot use the API. Use the API key of the main account.');
    assert.strictEqual(
      errorHint(1019),
      'Complete real-name verification before uploading: https://www.pgyer.com/account/certification'
    );
    assert.strictEqual(errorHint(1020), 'Uploading is disabled for this account. Contact PGYER customer service.');
    assert.strictEqual(
      errorHint(1022),
      'Your PGYER storage is full or the file is too large. Free up space or upgrade your plan.'
    );
    assert.strictEqual(errorHint(1247), undefined);
  });
});

describe('pgyer upload command', () => {
  let backup: string | null;
  let fake: FakeServer;
  let tokenAnswer: 'ok' | 'storage-full' = 'ok';

  before(async () => {
    backup = backupConfig();
    let baseUrl = '';
    const upload = uploadHandler(() => baseUrl);
    fake = await startFakeServer((request, response) => {
      if (tokenAnswer === 'storage-full' && request.path === '/apiv2/app/getCOSToken') {
        sendJson(response, { code: 1022, message: 'Storage is full' });
        return;
      }
      upload(request, response);
    });
    baseUrl = fake.baseUrl;
    saveTestConfig({ apiKey: API_KEY, apiUrl: baseUrl });
  });

  after(async () => {
    restoreConfig(backup);
    await fake.close();
  });

  function lastTokenForm(): Record<string, string> {
    const request = fake.requests.filter((item) => item.path === '/apiv2/app/getCOSToken').at(-1);
    return Object.fromEntries(request!.form);
  }

  it('does not reset the install type unless asked', async () => {
    const result = await runCli(['upload', apkPath, '--json'], { PGYER_API_KEY: '' });
    assert.strictEqual(result.code, 0, result.stderr);
    assert.strictEqual(JSON.parse(result.stdout).url, 'https://www.pgyer.com/demo');
    assert.deepStrictEqual(lastTokenForm(), { _api_key: API_KEY, buildType: 'android' });
    const storage = fake.requests.filter((item) => item.path === '/storage').at(-1);
    assert.match(String(storage!.headers['user-agent']), /^pgyer-cli\/\d+\.\d+\.\d+ Node\/v\d+/);
  });

  it('sends the install type for --install-type, --password and --invite-install', async () => {
    let result = await runCli(['upload', apkPath, '--install-type', 'public', '--json'], { PGYER_API_KEY: '' });
    assert.strictEqual(result.code, 0, result.stderr);
    assert.strictEqual(lastTokenForm().buildInstallType, '1');

    result = await runCli(['upload', apkPath, '--password', 'pw', '--json'], { PGYER_API_KEY: '' });
    assert.strictEqual(result.code, 0, result.stderr);
    assert.strictEqual(lastTokenForm().buildInstallType, '2');
    assert.strictEqual(lastTokenForm().buildPassword, 'pw');
    assert.ok(!result.stdout.includes('pw') && !result.stderr.includes('pw'));

    result = await runCli(['upload', apkPath, '--invite-install', '--upload-region', 'overseas', '--json'], {
      PGYER_API_KEY: '',
    });
    assert.strictEqual(result.code, 0, result.stderr);
    assert.strictEqual(lastTokenForm().buildInstallType, '3');
    assert.strictEqual(lastTokenForm().oversea, '1');

    result = await runCli(['upload', apkPath, '--install-type', 'public', '--password', 'pw', '--json'], {
      PGYER_API_KEY: '',
    });
    assert.notStrictEqual(result.code, 0);
    assert.match(result.stderr, /--password can only be used with --install-type password/);
  });

  it('prints the PGYER hint for API errors', async () => {
    tokenAnswer = 'storage-full';
    try {
      const json = await runCli(['upload', apkPath, '--json'], { PGYER_API_KEY: '' });
      assert.notStrictEqual(json.code, 0);
      const error = JSON.parse(json.stderr).error;
      assert.strictEqual(error.code, 'PGYER_1022');
      assert.strictEqual(error.message, 'Storage is full');
      assert.strictEqual(error.hint, 'Your PGYER storage is full or the file is too large. Free up space or upgrade your plan.');

      const human = await runCli(['upload', apkPath], { PGYER_API_KEY: '' });
      assert.notStrictEqual(human.code, 0);
      assert.match(human.stderr, /\[1022\] Storage is full\nYour PGYER storage is full/);
    } finally {
      tokenAnswer = 'ok';
    }
  });
});
