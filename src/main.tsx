import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// Post-processing - This might be specific to the template, verify its necessity
postMessage({ payload: 'removeLoading' }, '*')

// Inspect the electronAPI object
console.log('[Renderer] Checking window.electronAPI:', window.electronAPI);

// Use the exposed API from the preload script
if (window.electronAPI?.onMainProcessMessage) {
  const _removeListener = window.electronAPI.onMainProcessMessage((message) => {
    console.log('[Renderer] Received from main:', message) 
  });
  // TODO: Consider calling removeListener() when the component unmounts 
  //       if this were inside a React component lifecycle.
} else {
  console.warn("'window.electronAPI.onMainProcessMessage' not found. IPC message listening disabled.");
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  // Removed StrictMode - Was causing double renders/API calls
  <App />
  // </React.StrictMode>,
)
