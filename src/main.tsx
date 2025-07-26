import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// Post-processing - This might be specific to the template, verify its necessity
postMessage({ payload: 'removeLoading' }, '*')

// Use the exposed API from the preload script
if (window.electronAPI?.onMainProcessMessage) {
  const _removeListener = window.electronAPI.onMainProcessMessage((message) => {
    // Handle main process messages silently in production
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <App />
)
