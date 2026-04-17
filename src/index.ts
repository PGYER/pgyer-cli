import { cac } from 'cac';
import { setHumanMode, createLogger } from './utils/logger';
import { registerAuthCommands } from './commands/auth';
import { registerAppsCommands } from './commands/apps';
import { registerUploadCommand } from './commands/upload';

// CLI version from package.json
const VERSION = '0.1.0';

/**
 * Create and configure CLI
 */
function createCLI() {
  const cli = cac('pgyer');

  // Set version
  cli.version(VERSION);

  // Global options
  cli
    .option('-H, --human', 'Enable human-friendly output')
    .option('--json', 'Force JSON output')
    .option('--config <path>', 'Config file path');

  // Help text
  cli.help();

  return cli;
}

/**
 * Main entry point
 */
async function main() {
  const cli = createCLI();

  // Set human mode BEFORE parsing (check argv directly)
  const hasHumanFlag = process.argv.includes('-H') ||
    process.argv.includes('--human');
  const isHumanMode = hasHumanFlag || process.stdout.isTTY;
  setHumanMode(isHumanMode);

  // Register commands
  registerAuthCommands(cli);
  registerAppsCommands(cli);
  registerUploadCommand(cli);

  // Parse argv
  const result = cli.parse();

  // Handle no command
  if (!result.args.length && !result.options.help && !result.options.version) {
    cli.outputHelp();
  }
}

// Run CLI
main().catch((error) => {
  const logger = createLogger();
  const message = error instanceof Error ? error.message : 'Unknown error';
  logger.error(message);
  process.exit(1);
});
