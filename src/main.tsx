import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// Post-processing - This might be specific to the template, verify its necessity
postMessage({ payload: 'removeLoading' }, '*')

// Inspect the electronAPI object
console.log('[Renderer] Checking window.electronAPI:', window.electronAPI);

// Example: Use the exposed API from the preload script
// This is just an example; the App component might handle specific messages.
// Commenting out as the listener isn't used directly here.
/*
if (window.electronAPI?.onMainProcessMessage) {
  const _removeListener = window.electronAPI.onMainProcessMessage((message) => {
    console.log('[Renderer] Received example message from main:', message) 
  });
  // In a real app, manage the listener lifecycle (e.g., in a component)
} else {
  console.warn("'window.electronAPI.onMainProcessMessage' not found.");
}
*/

ReactDOM.createRoot(document.getElementById('root')!).render(
  // Removed StrictMode - Was causing double renders/API calls
  <App />
  // </React.StrictMode>,
)
