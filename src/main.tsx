import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ApiProvider } from './api'
import { ToastProvider, ErrorBoundary } from './components'
import './index.css'
import './styles/transitions.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <ApiProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </ApiProvider>
    </ErrorBoundary>
  </StrictMode>,
)
