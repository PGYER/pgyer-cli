import * as http from 'http';

export interface SeenRequest {
  method: string;
  /** Path and query string as received */
  url: string;
  path: string;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  /** Parsed body of form-urlencoded requests */
  form: URLSearchParams;
}

export type Handler = (request: SeenRequest, response: http.ServerResponse) => void;

export interface FakeServer {
  baseUrl: string;
  requests: SeenRequest[];
  close(): Promise<void>;
}

/** Starts an HTTP server on a random local port that records every request. */
export async function startFakeServer(handler: Handler): Promise<FakeServer> {
  const requests: SeenRequest[] = [];
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const body = Buffer.concat(chunks);
      const url = request.url ?? '/';
      const isForm = String(request.headers['content-type'] ?? '').includes('x-www-form-urlencoded');
      const seen: SeenRequest = {
        method: request.method ?? '',
        url,
        path: new URL(url, 'http://localhost').pathname,
        headers: request.headers,
        body,
        form: new URLSearchParams(isForm ? body.toString('utf8') : ''),
      };
      requests.push(seen);
      handler(seen, response);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no address');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise<void>((resolve, reject) => {
      server.closeAllConnections();
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  };
}

/** A base URL on which nothing listens, so connections are refused. */
export async function deadServerUrl(): Promise<string> {
  const fake = await startFakeServer(() => undefined);
  await fake.close();
  return fake.baseUrl;
}

export function sendJson(response: http.ServerResponse, body: unknown, status = 200): void {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify(body));
}

export function ok(response: http.ServerResponse, data: unknown): void {
  sendJson(response, { code: 0, message: '', data });
}

/** Parses the parts of a multipart/form-data body (enough for these tests). */
export function multipartParts(request: SeenRequest): { name: string; filename?: string; value: string }[] {
  const boundary = /boundary=(.+)$/.exec(String(request.headers['content-type']))?.[1];
  if (!boundary) return [];
  const text = request.body.toString('latin1');
  return text
    .split(`--${boundary}`)
    .slice(1, -1)
    .map((part) => {
      const [head, ...rest] = part.replace(/^\r\n/, '').split('\r\n\r\n');
      const value = rest.join('\r\n\r\n').replace(/\r\n$/, '');
      const name = /name="([^"]*)"/.exec(head)?.[1] ?? '';
      const filename = /filename="([^"]*)"/.exec(head)?.[1];
      return { name, filename, value };
    });
}

export function buildInfo(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    buildKey: 'build-key',
    buildType: '2',
    buildName: 'Demo App',
    buildVersion: '1.2.3',
    buildVersionNo: '45',
    buildBuildVersion: '7',
    buildIdentifier: 'com.example.demo',
    buildShortcutUrl: 'demo',
    buildFileName: 'demo.apk',
    buildFileSize: '14',
    buildCreated: '2026-10-21 12:00:00',
    buildUpdateDescription: 'Release notes',
    buildQRCodeURL: 'https://www.pgyer.com/app/qrcodeHistory/abc',
    ...overrides,
  };
}

/**
 * Handles the three fast-upload steps. `buildInfoCodes` lists the codes
 * returned by successive buildInfo calls before the published build.
 */
export function uploadHandler(
  getBaseUrl: () => string,
  options: {
    buildInfoCodes?: (number | 'html')[];
    storageStatus?: number;
    storageBody?: string;
    tokenParams?: Record<string, string>;
    info?: Record<string, unknown>;
  } = {}
): Handler {
  const codes = [...(options.buildInfoCodes ?? [])];
  return (request, response) => {
    if (request.path === '/apiv2/app/getCOSToken') {
      ok(response, {
        key: 'upload-key',
        endpoint: `${getBaseUrl()}/storage`,
        params: options.tokenParams ?? {
          key: 'apps/upload-key.apk',
          signature: 'secret-signature',
          'x-cos-security-token': 'secret-security-token',
        },
      });
      return;
    }
    if (request.path === '/storage') {
      response.statusCode = options.storageStatus ?? 204;
      response.end(options.storageBody ?? '');
      return;
    }
    if (request.path === '/apiv2/app/buildInfo') {
      const code = codes.shift();
      if (code === 'html') {
        response.setHeader('Content-Type', 'text/html');
        response.end('<html><body>Gateway error</body></html>');
      } else if (code !== undefined) {
        sendJson(response, { code, message: code === 1247 ? 'processing' : 'error' });
      } else {
        ok(response, buildInfo(options.info));
      }
      return;
    }
    response.statusCode = 404;
    response.end('not found');
  };
}
