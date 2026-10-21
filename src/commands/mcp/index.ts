import { type CAC } from 'cac';

/** Register `pgyer mcp`, which serves the PGYER tools to AI clients over stdio. */
export function registerMcpCommand(cli: CAC): void {
  cli
    .command('mcp', 'Start an MCP server on stdio for AI clients (Claude, Cursor, VS Code, Codex)')
    .usage('mcp')
    .action(async () => {
      // Loaded on demand so other commands do not pay for the MCP SDK.
      const { runStdioServer } = await import('../../mcp/server');
      await runStdioServer();
    });
}
