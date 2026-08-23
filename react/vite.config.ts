import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' so the built bundle loads via file:// inside Electron (loadFile).
export default defineConfig({
  plugins: [react()],
  base: './',
  build: { outDir: 'dist', emptyOutDir: true },
});