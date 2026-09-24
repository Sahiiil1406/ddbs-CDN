import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api/gateway': { target: process.env.VITE_GATEWAY_URL || 'http://localhost:3000', changeOrigin: true, rewrite: (p) => p.replace(/^\/api\/gateway/, '') },
      '/api/origin': { target: process.env.VITE_ORIGIN_URL || 'http://localhost:3001', changeOrigin: true, rewrite: (p) => p.replace(/^\/api\/origin/, '') },
      '/api/analytics': { target: process.env.VITE_ANALYTICS_URL || 'http://localhost:3007', changeOrigin: true, rewrite: (p) => p.replace(/^\/api\/analytics/, '') },
      '/api/replication': { target: process.env.VITE_REPLICATION_URL || 'http://localhost:3005', changeOrigin: true, rewrite: (p) => p.replace(/^\/api\/replication/, '') },
      '/api/coordinator': { target: process.env.VITE_COORDINATOR_URL || 'http://localhost:3006', changeOrigin: true, rewrite: (p) => p.replace(/^\/api\/coordinator/, '') }
    }
  }
});
