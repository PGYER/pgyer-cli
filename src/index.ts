import { cac } from 'cac';
import { setOutputMode, createLogger } from './utils/logger';
import { registerAuthCommands } from './commands/auth';
import { registerAppsCommands } from './commands/apps';
import { registerUploadCommand } from './commands/upload';
import { registerVersionCommands } from './commands/versions';
import { registerUploadStatusCommands } from './commands/uploads';
import { registerMcpCommand } from './commands/mcp';
import { CLI_VERSION as VERSION } from './core/version';

/**
 * Create and configure CLI
 */
function createCLI() {
  const cli = cac('pgyer');

  // Set version
  cli.version(VERSION);

  // Global options
  cli
    .option('-H, --human', 'Force human-friendly output (the default)')
    .option('--json', 'Output machine-readable JSON and disable prompts');

  // Help text
  cli.help((sections) => sections.map((section) => ({
    ...section,
    body: section.body.replace(/\b(apps|auth|versions|uploads):/g, '$1 '),
  })));

  return cli;
}

/**
 * Main entry point
 */
async function main() {
  const cli = createCLI();

  // Default output is intentionally shared by people and agents. JSON is an
  // explicit opt-in for callers that need a stable machine-readable format.
  const hasHumanFlag = process.argv.includes('-H') || process.argv.includes('--human');
  const hasJsonFlag = process.argv.includes('--json');

  if (hasJsonFlag && !hasHumanFlag) {
    setOutputMode('json');
  } else {
    setOutputMode('human');
  }

  // Register commands
  registerAuthCommands(cli);
  registerAppsCommands(cli);
  registerUploadCommand(cli);
  registerVersionCommands(cli);
  registerUploadStatusCommands(cli);
  registerMcpCommand(cli);

  // CAC does not natively support git-style nested commands. Internally use a
  // colon while keeping the public interface as `pgyer apps list`.
  const argv = normalizeNestedCommand(process.argv);

  cli.on('command:*', () => {
    const command = argv.slice(2).filter(arg => !arg.startsWith('-')).slice(0, 2).join(' ');
    throw new Error(`Unknown command: ${command || '(none)'}`);
  });

  // Parse argv
  const result = cli.parse(argv);

  // Handle no command
  if (!cli.matchedCommand && !result.args.length && !result.options.help && !result.options.version) {
    cli.outputHelp();
  }
}

function normalizeNestedCommand(argv: string[]): string[] {
  const groups = new Set(['apps', 'auth', 'versions', 'uploads']);
  const normalized = [...argv];
  const commandIndex = normalized.findIndex((arg, index) => index >= 2 && !arg.startsWith('-'));

  if (commandIndex === -1 || !groups.has(normalized[commandIndex])) {
    return normalized;
  }

  const actionIndex = commandIndex + 1;
  const action = normalized[actionIndex];
  if (!action || action.startsWith('-')) {
    return normalized;
  }

  normalized.splice(commandIndex, 2, `${normalized[commandIndex]}:${action}`);
  return normalized;
}

// Run CLI
main().catch((error) => {
  const logger = createLogger();
  const message = error instanceof Error ? error.message : 'Unknown error';
  logger.error(message);
  process.exit(1);
});
