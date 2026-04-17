import { loadConfig, saveConfig } from '../../core/config';
import { createLogger, isHuman } from '../../utils/logger';

/**
 * Handle auth logout command
 */
export function handleAuthLogout(): void {
  const logger = createLogger();

  try {
    const config = loadConfig();

    // Clear only user-related fields, preserve other settings
    const { apiKey, ukey, name, ...restConfig } = config;

    if (apiKey || ukey || name) {
      saveConfig(restConfig);
    }

    if (isHuman()) {
      logger.success('Logged out successfully');
    } else {
      logger.json({ success: true });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Logout failed';
    logger.error(message);
    process.exit(1);
  }
}
