import { createRoot } from 'react-dom/client'
import App from './App'

const root = document.getElementById('root')
if (!root) throw new Error('应用根节点不存在')
createRoot(root).render(<App />)
