import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

const container = document.getElementById('root')
if (!container) throw new Error('Element #root absent de index.html')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
