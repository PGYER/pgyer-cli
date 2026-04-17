import { loadFileConfig } from '../../core/config';
import { ENV_VARS } from '../../core/env';
import { createLogger, isHuman } from '../../utils/logger';

/**
 * Handle auth status command
 */
export function handleAuthStatus(): void {
  const logger = createLogger();
  const fileConfig = loadFileConfig();
  const envApiKey = process.env[ENV_VARS.API_KEY];

  // Check if logged in via auth login (has apiKey in config file)
  if (fileConfig.apiKey) {
    if (isHuman()) {
      if (fileConfig.name && fileConfig.ukey) {
        logger.success(`Logged in as ${fileConfig.name} <${fileConfig.ukey}>`);
      } else if (fileConfig.ukey) {
        logger.success(`Logged in as ${fileConfig.ukey}`);
      } else {
        logger.success('Logged in');
      }
    } else {
      logger.json({ loggedIn: true, user: fileConfig.name });
    }
    return;
  }

  // Check if authenticated via environment variable
  if (envApiKey) {
    if (isHuman()) {
      logger.success('Logged in via API');
    } else {
      logger.json({ loggedIn: true });
    }
    return;
  }

  // Not logged in
  if (isHuman()) {
    logger.info('Not logged in');
  } else {
    logger.json({ loggedIn: false });
  }
}
