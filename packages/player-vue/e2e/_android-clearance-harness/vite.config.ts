import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'node:path'

// Standalone build of the bottom-clearance harness page (verification only).
export default defineConfig({
  root: __dirname,
  plugins: [vue()],
  resolve: { alias: { '@': path.resolve(__dirname, '../../src') } },
  build: { outDir: path.resolve(__dirname, 'dist'), emptyOutDir: true },
})
