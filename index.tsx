import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// Register Service Worker for Android/iOS Notifications
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      console.log('SW registered:', registration);
      
      // Force update to ensure latest logic is active
      registration.update();
    } catch (error) {
      console.log('SW registration failed:', error);
    }
  });
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);