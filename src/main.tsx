import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ApiProvider } from './api'
import { ToastProvider } from './components'
import './index.css'
import './styles/transitions.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ApiProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </ApiProvider>
  </StrictMode>,
)
