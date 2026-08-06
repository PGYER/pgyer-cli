import { loadConfig } from '../../core/config';
import { createLogger, isHuman } from '../../utils/logger';

/**
 * Handle auth token command
 */
function redactToken(token: string): string {
  if (token.length <= 8) return '*'.repeat(token.length);
  return `${token.slice(0, 4)}${'*'.repeat(Math.min(12, token.length - 8))}${token.slice(-4)}`;
}

export function handleAuthToken(reveal: boolean = false): void {
  const logger = createLogger();
  const config = loadConfig();

  if (!config.apiKey) {
    // Error output should be plain text with "Error: " prefix
    logger.error('Not logged in');
    process.exit(1);
  }

  const token = reveal ? config.apiKey : redactToken(config.apiKey);
  if (isHuman()) {
    logger.text(`API Token: ${token}${reveal ? '' : ' (redacted)'}`);
  } else {
    logger.json({ token, redacted: !reveal });
  }
}
