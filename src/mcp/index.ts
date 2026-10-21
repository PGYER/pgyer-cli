/**
 * `@pgyer/cli/mcp`: the PGYER MCP server, for packages such as
 * `pgyer-mcp-server` that start it without going through the CLI.
 */
export { createPgyerMcpServer, runStdioServer, type PgyerMcpServerOptions } from './server';
export { CLI_VERSION as version } from '../core/version';
