import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Core React - rarely changes
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          // Data fetching - medium change frequency
          'vendor-query': ['@tanstack/react-query'],
          // Icons - changes with new features
          'vendor-icons': ['lucide-react'],
          // Heavy animation lib - load on demand
          'vendor-lottie': ['lottie-react', 'lottie-web'],
        },
      },
    },
    // Increase warning threshold since we're intentionally chunking
    chunkSizeWarningLimit: 600,
  },
})
