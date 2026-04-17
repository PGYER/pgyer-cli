import * as http from 'http';
import * as net from 'net';
import open from 'open';
import { saveConfig, loadConfig } from '../../core/config';
import { createLogger, isHuman } from '../../utils/logger';
import { createSpinner } from '../../utils/spinner';

const DEFAULT_PORT = 3456;
const MAX_PORT_ATTEMPTS = 10;

/** Auth data returned from server */
interface AuthData {
  ukey: string;
  name: string;
  apikey: string;
}

/**
 * Check if a port is available
 */
function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = net
      .createServer()
      .once('error', () => resolve(false))
      .once('listening', () => {
        tester.once('close', () => resolve(true)).close();
      })
      .listen(port);
  });
}

/**
 * Find an available port starting from the default port
 */
async function findAvailablePort(startPort: number, maxAttempts: number = MAX_PORT_ATTEMPTS): Promise<number> {
  for (let port = startPort; port < startPort + maxAttempts; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found in range ${startPort}-${startPort + maxAttempts - 1}`);
}

/**
 * Decode base64url encoded auth data from server
 */
function decodeAuthData(auth: string): AuthData {
  // Convert base64url back to standard base64
  const base64 = auth.replace(/-/g, '+').replace(/_/g, '/');
  // Add padding if needed
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const decoded = Buffer.from(padded, 'base64').toString('utf-8');
  return JSON.parse(decoded) as AuthData;
}

/**
 * Start local HTTP server for OAuth callback
 */
function startCallbackServer(port: number): Promise<AuthData> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (!req.url) {
        res.statusCode = 400;
        res.end('Bad Request');
        return;
      }

      const url = new URL(req.url, `http://localhost:${port}`);
      const auth = url.searchParams.get('auth');

      if (auth) {
        try {
          const authData = decodeAuthData(auth);
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/html');
          res.end(`
            <html>
              <body>
                <h1>Login Successful</h1>
                <p>You can close this window now.</p>
                <script>window.close();</script>
              </body>
            </html>
          `);
          server.close();
          resolve(authData);
        } catch (e) {
          res.statusCode = 400;
          res.end('Invalid auth data');
          server.close();
          reject(new Error('Failed to decode auth data'));
        }
      } else {
        res.statusCode = 400;
        res.end('Missing auth parameter');
        server.close();
        reject(new Error('Missing auth parameter in callback'));
      }
    });

    server.on('error', (err) => {
      reject(err);
    });

    server.listen(port, () => {
      console.error(`Callback server listening on port ${port}`);
    });
  });
}

/**
 * Handle auth login command
 */
export async function handleAuthLogin(): Promise<void> {
  const logger = createLogger();

  // Find an available port
  const port = await findAvailablePort(DEFAULT_PORT);

  try {
    const authUrl = `https://www.pgyer.com/account/api?cli_auth_port=${port}`;

    if (process.stdout.isTTY) {
      console.error(`Opening browser to: ${authUrl}`);
      console.error(`Waiting for callback on port ${port}...`);
    }

    const spinner = createSpinner('Waiting for browser authorization...');
    spinner.start();

    // Start callback server first
    const callbackPromise = startCallbackServer(port);

    // Then open browser
    await open(authUrl);

    // Wait for callback
    const { ukey, name, apikey } = await callbackPromise;

    // Save to config
    const existingConfig = loadConfig();
    saveConfig({
      ...existingConfig,
      apiKey: apikey,
      ukey,
      name,
    });

    spinner.succeed(`Login successful! Logged in as ${name} <${ukey}>`);

    // Only output JSON in non-human mode
    if (!isHuman()) {
      logger.json({ success: true, user: name, ukey });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Login failed';
    logger.error(message);
    process.exit(1);
  }
}
