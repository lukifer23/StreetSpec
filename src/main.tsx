import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import './index.css'

// Handle any uncaught errors in the renderer process
window.addEventListener('error', (event) => {
  console.error('Renderer error:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
});

// Log env visibility for debugging key injection
console.debug('[env] VITE_GOOGLE_MAPS_API_KEY present?', Boolean((import.meta as any).env?.VITE_GOOGLE_MAPS_API_KEY));

// Error handler for the ErrorBoundary
const handleError = (error: Error, errorInfo: React.ErrorInfo) => {
  console.error('Application error caught by ErrorBoundary:', error, errorInfo);

  // In production, you might want to send this to an error tracking service
  if ((process.env as any).NODE_ENV === 'production') {
    // Example: errorTracker.captureException(error, { extra: errorInfo });
  }
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary onError={handleError}>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
