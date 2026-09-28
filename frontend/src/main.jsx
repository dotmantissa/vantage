import React from 'react';
import ReactDOM from 'react-dom/client';
import { PrivyProvider } from '@privy-io/react-auth';
import App from './App';
import './styles/tokens.css';

const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID || 'cmul43s3k01p20cjnixbpbsvf';

// Define GenLayer StudioNet chain
const genlayerStudioNet = {
  id: 61999,
  name: 'GenLayer StudioNet',
  network: 'genlayer-studionet',
  nativeCurrency: {
    name: 'GEN',
    symbol: 'GEN',
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ['https://studio.genlayer.com/api'],
    },
    public: {
      http: ['https://studio.genlayer.com/api'],
    },
  },
  blockExplorers: {
    default: {
      name: 'GenLayer Studio',
      url: 'https://studio.genlayer.com',
    },
  },
};

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ['email', 'wallet'],
        appearance: {
          theme: 'light',
          accentColor: '#53745f',
          showWalletLoginFirst: false,
        },
        embeddedWallets: {
          createOnLogin: 'users-without-wallets',
        },
        defaultChain: genlayerStudioNet,
        supportedChains: [genlayerStudioNet],
      }}
    >
      <App />
    </PrivyProvider>
  </React.StrictMode>
);
