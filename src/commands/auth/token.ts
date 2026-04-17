import { loadConfig } from '../../core/config';
import { createLogger, isHuman } from '../../utils/logger';

/**
 * Handle auth token command
 */
export function handleAuthToken(): void {
  const logger = createLogger();
  const config = loadConfig();

  if (!config.apiKey) {
    // Error output should be plain text with "Error: " prefix
    logger.error('Not logged in');
    process.exit(1);
  }

  if (isHuman()) {
    logger.text(`API Token: ${config.apiKey}`);
  } else {
    logger.json({ token: config.apiKey });
  }
}
