import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  target: 'node18',
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
