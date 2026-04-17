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

  // Determine output mode BEFORE parsing
  // Priority: --human > --json > TTY detection
  const hasHumanFlag = process.argv.includes('-H') || process.argv.includes('--human');
  const hasJsonFlag = process.argv.includes('--json');

  let isHumanMode: boolean;
  if (hasHumanFlag) {
    // --human takes highest priority
    isHumanMode = true;
  } else if (hasJsonFlag) {
    // --json forces JSON output
    isHumanMode = false;
  } else {
    // Default: determine by TTY
    isHumanMode = process.stdout.isTTY ?? false;
  }
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
