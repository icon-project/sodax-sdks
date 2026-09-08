import './polyfill';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { gtmId, trackInEmbed } from './config';
import './index.css';
import { initAnalytics } from './lib/analytics';
import { initialUrl } from './lib/initialUrl';
import Providers from './providers';

// bigint serialization — wallet SDKs serialize state to JSON in places.
// `Object.defineProperty` adds the method without asserting the prototype shape.
Object.defineProperty(BigInt.prototype, 'toJSON', {
  value: function toJSON(this: bigint) {
    return this.toString();
  },
  writable: true,
  configurable: true,
});

initAnalytics({ gtmId, embedded: initialUrl.embed, allowInEmbed: trackInEmbed });

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root element not found');

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Providers>
        <App />
      </Providers>
    </ErrorBoundary>
  </React.StrictMode>,
);
