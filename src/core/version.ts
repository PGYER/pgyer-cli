// Bundled by tsup so the version always matches the published package.
const { version } = require('../../package.json') as { version: string };

export const CLI_VERSION: string = version;

/** User-Agent of requests made by CLI commands. */
export const CLI_USER_AGENT = `pgyer-cli/${CLI_VERSION} Node/${process.version}`;

/**
 * User-Agent of requests made by `pgyer mcp`. PGYER classifies uploads by the
 * first product token, so the MCP server names itself first.
 */
export const MCP_USER_AGENT = `pgyer-mcp-server/${CLI_VERSION} ${CLI_USER_AGENT}`;
