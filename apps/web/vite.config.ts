import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // same-origin /api in development, like the /api route of the Vercel deployment
    proxy: { '/api': `http://localhost:${process.env.API_PORT ?? 8787}` },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 2500, // three.js + globe.gl live in their own chunk, loaded only by the globe pages
  },
});
