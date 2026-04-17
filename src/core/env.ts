/**
 * Environment variable names
 */
export const ENV_VARS = {
  API_KEY: 'PGYER_API_KEY',
  OUTPUT_FORMAT: 'PGYER_OUTPUT_FORMAT',
  API_URL: 'PGYER_API_URL',
} as const;

/**
 * Parse environment variables into config
 */
export function parseEnvConfig(): {
  apiKey?: string;
  apiUrl?: string;
  outputFormat?: 'json' | 'text';
} {
  const config: {
    apiKey?: string;
    apiUrl?: string;
    outputFormat?: 'json' | 'text';
  } = {};

  const apiKey = process.env[ENV_VARS.API_KEY];
  if (apiKey) {
    config.apiKey = apiKey;
  }

  const apiUrl = process.env[ENV_VARS.API_URL];
  if (apiUrl) {
    config.apiUrl = apiUrl;
  }

  const outputFormat = process.env[ENV_VARS.OUTPUT_FORMAT];
  if (outputFormat === 'json' || outputFormat === 'text') {
    config.outputFormat = outputFormat;
  }

  return config;
}

/**
 * Get a specific environment variable
 */
export function getEnvVar(name: keyof typeof ENV_VARS): string | undefined {
  return process.env[ENV_VARS[name]];
}
