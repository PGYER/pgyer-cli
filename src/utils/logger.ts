import pc from 'picocolors';

export type OutputMode = 'human' | 'json';

let outputMode: OutputMode = 'human';

export function setOutputMode(mode: OutputMode): void {
  outputMode = mode;
}

/**
 * Set the output mode globally
 */
export function setHumanMode(enabled: boolean): void {
  outputMode = enabled ? 'human' : 'json';
}

/**
 * Get current human mode status
 */
export function isHuman(): boolean {
  return outputMode === 'human';
}

export function isNonInteractive(): boolean {
  return outputMode !== 'human' || !process.stdin.isTTY;
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
 * JSON logger for explicit machine-readable output
 */
class JsonLogger implements Logger {
  json(data: unknown): void {
    console.log(JSON.stringify(data));
  }

  text(message: string): void {
    console.log(message);
  }

  error(message: string): void {
    const classification = classifyError(message);
    console.error(JSON.stringify({
      error: {
        ...classification,
        message: message.replace(/^\[\d+\]\s*/, ''),
      },
    }));
  }

  table(_data: Record<string, unknown>[]): void {
    // Tables not supported in JSON mode, output as JSON
    console.log(JSON.stringify(_data));
  }

  success(message: string): void {
    console.log(JSON.stringify({ success: true, message }));
  }

  info(message: string): void {
    console.error(JSON.stringify({ info: { message } }));
  }
}

function classifyError(message: string): {
  code: string;
  retryable: boolean;
  hint?: string;
} {
  const apiCode = message.match(/^\[(\d+)\]/)?.[1];
  if (apiCode === '1001' || apiCode === '1002' || apiCode === '1055') {
    return {
      code: 'AUTH_FAILED',
      retryable: false,
      hint: 'Run pgyer auth login or set PGYER_API_KEY',
    };
  }
  if (apiCode === '1098') {
    return { code: 'RATE_LIMITED', retryable: true, hint: 'Retry after a delay' };
  }
  if (/API Key|Not logged in|Not authenticated/i.test(message)) {
    return {
      code: 'AUTH_REQUIRED',
      retryable: false,
      hint: 'Run pgyer auth login or set PGYER_API_KEY',
    };
  }
  if (/timed out|timeout/i.test(message)) {
    return { code: 'TIMEOUT', retryable: true };
  }
  if (/Confirmation requires|use --force/i.test(message)) {
    return { code: 'CONFIRMATION_REQUIRED', retryable: false, hint: 'Review the target and retry with --force' };
  }
  if (/Cancelled/i.test(message)) {
    return { code: 'CANCELLED', retryable: false };
  }
  if (/File not found|Path is not a file/i.test(message)) {
    return { code: 'FILE_NOT_FOUND', retryable: false };
  }
  if (/must |cannot |required|Unsupported|Unknown |At least one|Invalid/i.test(message)) {
    return { code: 'INVALID_ARGUMENT', retryable: false };
  }
  if (apiCode) {
    return { code: `PGYER_${apiCode}`, retryable: false };
  }
  return { code: 'COMMAND_FAILED', retryable: false };
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
    const headers = Object.keys(data[0]);
    const rows = data.map(item => headers.map(h => String(item[h] ?? '')));

    // Get display width of a string (handles CJK characters)
    const getDisplayWidth = (str: string): number => {
      let width = 0;
      for (const char of str) {
        // CJK characters and fullwidth characters have width of 2
        width += char.charCodeAt(0) > 127 ? 2 : 1;
      }
      return width;
    };

    // Pad string to display width
    const padToWidth = (str: string, width: number): string => {
      const currentWidth = getDisplayWidth(str);
      const padding = width - currentWidth;
      return str + ' '.repeat(Math.max(0, padding));
    };

    // Calculate column widths based on display width
    const widths = headers.map((h, i) =>
      Math.max(getDisplayWidth(h), ...rows.map(r => getDisplayWidth(r[i])))
    );

    // Print header
    const headerRow = headers.map((h, i) => pc.bold(padToWidth(h, widths[i]))).join(' │ ');
    console.log(headerRow);

    // Print separator
    const separator = widths.map(w => '─'.repeat(w)).join('─┼─');
    console.log(pc.gray(separator));

    // Print rows
    for (const row of rows) {
      console.log(row.map((cell, i) => padToWidth(cell, widths[i])).join(' │ '));
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
  if (outputMode === 'human') {
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
