import { createRoot } from 'react-dom/client'
import './styles.css'
import { App } from './App'
import { initStore } from './lib/store'

void initStore().then(() => createRoot(document.getElementById('root')!).render(<App />))
