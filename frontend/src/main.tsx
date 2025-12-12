import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Suppress browser extension errors (harmless, from content scripts)
window.addEventListener('error', (event) => {
  if (event.message && event.message.includes('Could not establish connection')) {
    // Suppress browser extension connection errors
    event.preventDefault();
    return false;
  }
});

// Suppress unhandled promise rejections from extensions
window.addEventListener('unhandledrejection', (event) => {
  if (event.reason && typeof event.reason === 'string' && event.reason.includes('Receiving end does not exist')) {
    // Suppress browser extension errors
    event.preventDefault();
    return false;
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
