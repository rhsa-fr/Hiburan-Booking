import { defineConfig } from 'vite';
import path from 'node:path';

const root = process.cwd();

export default defineConfig({
  // NestJS uses parameter decorators; esbuild must be told explicitly.
  esbuild: {
    target: 'es2022',
    tsconfigRaw: {
      compilerOptions: {
        experimentalDecorators: true,
        useDefineForClassFields: false,
        target: 'es2022'
      }
    }
  },
  resolve: {
    alias: [
      { find: /^@tarlink\/platform\/(.+)$/, replacement: path.join(root, 'libs/platform/$1/src/index.ts') },
      { find: /^@tarlink\/modules\/(.+)$/, replacement: path.join(root, 'libs/modules/$1/src/index.ts') },
      { find: /^@tarlink\/core\/(.+)$/, replacement: path.join(root, 'apps/api/src/core/$1') }
    ]
  }
});
