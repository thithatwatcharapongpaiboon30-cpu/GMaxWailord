import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// Register Service Worker for Android/iOS Notifications
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      console.log('SW registered:', registration);
      
      // Check for existing notifications permission
      if ('Notification' in window && Notification.permission === 'granted') {
        console.log('Notification permission already granted');
      }
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