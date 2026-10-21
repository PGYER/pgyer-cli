import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    mcp: 'src/mcp/index.ts',
  },
  format: ['cjs'],
  target: 'node20',
  minify: true,
  bundle: true,
  sourcemap: false,
  dts: true,
  clean: true,
  banner: {
    js: '#!/usr/bin/env node',
  },
  outDir: 'dist',
});
