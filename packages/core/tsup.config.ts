import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'engine/index': 'src/engine/index.ts',
    'learning/index': 'src/learning/index.ts',
    'config/index': 'src/config/index.ts',
    'data/index': 'src/data/index.ts',
    'cache/index': 'src/cache/index.ts',
    'persistence/index': 'src/persistence/index.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  treeshake: true,
});
