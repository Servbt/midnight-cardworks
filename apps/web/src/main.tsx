import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AuthProvider } from './auth';
import './styles.css';
document.body.classList.remove('preload-landing');
createRoot(document.getElementById('root')!).render(<StrictMode><AuthProvider><App /></AuthProvider></StrictMode>);
