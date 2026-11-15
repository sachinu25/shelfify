import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Same-origin API in development (mirrors the production rewrite), so the
    // httpOnly refresh cookie works without cross-site configuration.
    proxy: { '/api': { target: process.env.VITE_DEV_API || 'http://localhost:5000', changeOrigin: true } },
  },
  preview: {
    proxy: { '/api': { target: process.env.VITE_DEV_API || 'http://localhost:5000', changeOrigin: true } },
  },
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          query: ['@tanstack/react-query', 'axios'],
          charts: ['recharts'],
          motion: ['framer-motion'],
        },
      },
    },
  },
});
