import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 5173, host: true },
  build: {
    target: 'es2022',
    outDir: 'dist',
    // The renderer, the UI and the asset library each change at very different
    // rates; splitting them keeps a UI tweak from busting the 600kb three.js chunk.
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          react: ['react', 'react-dom'],
        },
      },
    },
  },
  worker: { format: 'es' },
});
