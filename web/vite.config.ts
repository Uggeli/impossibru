import { defineConfig } from 'vite';
import { version } from './package.json';

export default defineConfig({
  base: './',
  plugins: [{
    name: 'editor-version',
    transformIndexHtml: () => [{ tag: 'meta', attrs: { name: 'application-version', content: version } }]
  }],
  server: { fs: { allow: ['.', '../examples'] } },
  build: { outDir: 'dist', emptyOutDir: true }
});
