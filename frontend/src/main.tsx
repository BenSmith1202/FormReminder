import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Suppress browser extension errors (harmless, from content scripts like content.js)
window.addEventListener('error', (event) => {
  const msg = (event.message || (event.error && event.error.message) || '').toString();
  if (msg.includes('Could not establish connection') || msg.includes('Receiving end does not exist')) {
    event.preventDefault();
    event.stopPropagation();
    return true;
  }
});

// Suppress unhandled promise rejections from extensions
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  const msg = reason?.message ?? (typeof reason === 'string' ? reason : '');
  if (msg.includes('Could not establish connection') || msg.includes('Receiving end does not exist')) {
    event.preventDefault();
    return true;
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
