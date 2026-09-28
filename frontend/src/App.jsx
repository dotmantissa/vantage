import React, { useState, useEffect } from 'react';
import Header from './components/Header';
import MarketsPage from './pages/MarketsPage';
import MarketDetailPage from './pages/MarketDetailPage';
import CreateMarketPage from './pages/CreateMarketPage';
import PrecedentsPage from './pages/PrecedentsPage';
import CharterPage from './pages/CharterPage';

export default function App() {
  const [currentView, setCurrentView] = useState('markets');
  const [selectedMarketId, setSelectedMarketId] = useState(null);
  const [theme, setTheme] = useState(() => localStorage.getItem('vantage_theme') || 'light');
  const [userBalance, setUserBalance] = useState(null);

  // Sync theme to DOM
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('vantage_theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

  const handleSelectMarket = (marketId) => {
    setSelectedMarketId(marketId);
    setCurrentView('market-detail');
  };

  const handleMarketCreated = (newMarketId) => {
    setSelectedMarketId(newMarketId);
    setCurrentView('market-detail');
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Header
        currentView={currentView}
        setCurrentView={(view) => {
          setCurrentView(view);
          if (view !== 'market-detail') setSelectedMarketId(null);
        }}
        theme={theme}
        toggleTheme={toggleTheme}
        userBalance={userBalance}
      />

      <main style={{ flex: 1 }}>
        {currentView === 'markets' && (
          <MarketsPage
            onSelectMarket={handleSelectMarket}
            onNavigateCreate={() => setCurrentView('create')}
          />
        )}

        {currentView === 'market-detail' && (
          <MarketDetailPage
            marketId={selectedMarketId || '1'}
            onBack={() => {
              setCurrentView('markets');
              setSelectedMarketId(null);
            }}
          />
        )}

        {currentView === 'create' && (
          <CreateMarketPage
            onMarketCreated={handleMarketCreated}
          />
        )}

        {currentView === 'precedents' && (
          <PrecedentsPage
            onSelectMarket={handleSelectMarket}
          />
        )}

        {currentView === 'charter' && (
          <CharterPage />
        )}
      </main>

      {/* Footer */}
      <footer style={{
        borderTop: 'var(--border-rule)',
        background: 'var(--paper-raised)',
        padding: '24px',
        marginTop: 64,
        fontFamily: 'var(--font-mono)',
        fontSize: '0.78rem',
        color: 'var(--ink-muted)',
      }}>
        <div style={{
          maxWidth: 1280,
          margin: '0 auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 16,
        }}>
          <div>
            VANTAGE &copy; 2026 &bull; Autonomous Resolution via GenLayer Intelligent Contracts
          </div>
          <div style={{ display: 'flex', gap: 16 }}>
            <span>StudioNet (61999)</span>
            <span>Design Seed: 1790593893576409612</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
