import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load env file based on mode
  const env = loadEnv(mode, process.cwd(), '')

  // For E2E tests: if VITE_API_URL is set in process.env, use it (override .env)
  // This allows Playwright to override the API URL for testing
  const apiUrl = process.env.VITE_API_URL || env.VITE_API_URL

  return {
    plugins: [react()],
    base: './', // Use relative paths for Capacitor iOS/Android
    define: {
      // Ensure the API URL from process.env takes precedence
      'import.meta.env.VITE_API_URL': JSON.stringify(apiUrl),
    },
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
  }
})
