import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AuthProvider } from './auth';
import './styles.css';
import { receiptTokenFor } from './receiptAccess';

// Scrub private receipt fragments before rendering Clerk or loading optional analytics.
if (window.location.pathname === '/checkout/success') {
  const orderId = new URLSearchParams(window.location.search).get('order');
  if (orderId) receiptTokenFor(orderId);
}
document.body.classList.remove('preload-landing');
createRoot(document.getElementById('root')!).render(<StrictMode><AuthProvider><App /></AuthProvider></StrictMode>);
