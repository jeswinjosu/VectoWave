import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `SINGLE=1 vite build` produces one self-contained index.html (handy for embedding/demo hosting).
export default defineConfig({
  // Relative asset paths so the build works under any GitHub Pages sub-path (/<repo>/)
  base: './',
  plugins: [react(), ...(process.env.SINGLE ? [viteSingleFile()] : [])],
});
