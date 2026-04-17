import pc from 'picocolors';

/**
 * Global flag to enable human-friendly output
 */
let isHumanMode = false;

/**
 * Set the output mode globally
 */
export function setHumanMode(enabled: boolean): void {
  isHumanMode = enabled;
}

/**
 * Get current human mode status
 */
export function isHuman(): boolean {
  return isHumanMode;
}

/**
 * Logger interface for dual-mode output
 */
export interface Logger {
  /** Output structured JSON data */
  json(data: unknown): void;
  /** Output plain text message */
  text(message: string): void;
  /** Output error message */
  error(message: string): void;
  /** Output table data (only effective in human mode) */
  table(data: Record<string, unknown>[]): void;
  /** Output success message (only effective in human mode) */
  success(message: string): void;
  /** Output info message */
  info(message: string): void;
}

/**
 * JSON logger for LLM-friendly output (default mode)
 */
class JsonLogger implements Logger {
  json(data: unknown): void {
    console.log(JSON.stringify(data));
  }

  text(message: string): void {
    console.log(message);
  }

  error(message: string): void {
    console.error(`Error: ${message}`);
  }

  table(_data: Record<string, unknown>[]): void {
    // Tables not supported in JSON mode, output as JSON
    console.log(JSON.stringify(_data));
  }

  success(message: string): void {
    console.log(JSON.stringify({ success: true, message }));
  }

  info(message: string): void {
    console.error(message);
  }
}

/**
 * Human-friendly logger with colors and formatting
 */
class HumanLogger implements Logger {
  json(data: unknown): void {
    console.log(JSON.stringify(data, null, 2));
  }

  text(message: string): void {
    console.log(message);
  }

  error(message: string): void {
    console.error(pc.red(`✖ Error: ${message}`));
  }

  table(data: Record<string, unknown>[]): void {
    if (data.length === 0) {
      console.log(pc.gray('No data'));
      return;
    }
    // Simple table output
    const headers = Object.keys(data[0]);
    const rows = data.map(item => headers.map(h => String(item[h] ?? '')));

    // Calculate column widths
    const widths = headers.map((h, i) =>
      Math.max(h.length, ...rows.map(r => r[i].length))
    );

    // Print header
    const headerRow = headers.map((h, i) => h.padEnd(widths[i])).join('  ');
    console.log(pc.bold(headerRow));

    // Print separator
    const separator = widths.map(w => '-'.repeat(w)).join('  ');
    console.log(pc.gray(separator));

    // Print rows
    for (const row of rows) {
      console.log(row.map((cell, i) => cell.padEnd(widths[i])).join('  '));
    }
  }

  success(message: string): void {
    console.log(pc.green(`✔ ${message}`));
  }

  info(message: string): void {
    console.log(pc.blue(`ℹ ${message}`));
  }
}

/**
 * Create a logger instance based on current mode
 */
export function createLogger(): Logger {
  if (isHumanMode) {
    return new HumanLogger();
  }
  return new JsonLogger();
}

/**
 * Quick access to logger functions
 */
export const logger = {
  json: (data: unknown) => createLogger().json(data),
  text: (message: string) => createLogger().text(message),
  error: (message: string) => createLogger().error(message),
  table: (data: Record<string, unknown>[]) => createLogger().table(data),
  success: (message: string) => createLogger().success(message),
  info: (message: string) => createLogger().info(message),
};
