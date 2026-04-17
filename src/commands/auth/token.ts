import { loadConfig } from '../../core/config';
import { createLogger, isHuman } from '../../utils/logger';

/**
 * Handle auth token command
 */
export function handleAuthToken(): void {
  const logger = createLogger();
  const config = loadConfig();

  if (!config.apiKey) {
    if (isHuman()) {
      logger.error('Not logged in');
    } else {
      logger.json({ error: 'not_logged_in' });
    }
    process.exit(1);
  }

  if (isHuman()) {
    logger.text(`Token: ${config.apiKey}`);
  } else {
    logger.json({ token: config.apiKey });
  }
}
