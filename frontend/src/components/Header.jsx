import React from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { Scale, BookOpen, PlusCircle, ShieldCheck, Sun, Moon, LogIn, LogOut, Wallet } from 'lucide-react';
import { formatGen } from '../lib/contracts';

export default function Header({ currentView, setCurrentView, theme, toggleTheme, userBalance }) {
  const { ready, authenticated, user, login, logout } = usePrivy();

  const activeWallet = user?.wallet?.address;
  const shortAddress = activeWallet
    ? `${activeWallet.slice(0, 6)}...${activeWallet.slice(-4)}`
    : null;

  return (
    <header style={{
      borderBottom: 'var(--border-rule)',
      background: 'var(--paper)',
      position: 'sticky',
      top: 0,
      zIndex: 50,
    }}>
      <div style={{
        maxWidth: 1280,
        margin: '0 auto',
        padding: '16px 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 16,
      }}>
        {/* Brand */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <button
            onClick={() => setCurrentView('markets')}
            style={{
              fontFamily: 'var(--font-slab)',
              fontSize: '1.65rem',
              fontWeight: 700,
              letterSpacing: '-0.02em',
              color: 'var(--ink)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            VANTAGE
          </button>
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--t-machine)',
            color: 'var(--ink-muted)',
            borderLeft: 'var(--border-rule)',
            paddingLeft: 12,
          }}>
            RESOLUTION BY CONSENSUS
          </span>
        </div>

        {/* Navigation */}
        <nav style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={() => setCurrentView('markets')}
            style={{
              padding: '6px 14px',
              borderRadius: 'var(--radius-control)',
              fontSize: 'var(--t-control)',
              fontWeight: 600,
              color: currentView === 'markets' ? 'var(--ink)' : 'var(--ink-muted)',
              background: currentView === 'markets' ? 'var(--paper-raised)' : 'transparent',
              border: currentView === 'markets' ? 'var(--border-rule)' : '1px solid transparent',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Scale size={15} />
            Markets
          </button>

          <button
            onClick={() => setCurrentView('create')}
            style={{
              padding: '6px 14px',
              borderRadius: 'var(--radius-control)',
              fontSize: 'var(--t-control)',
              fontWeight: 600,
              color: currentView === 'create' ? 'var(--ink)' : 'var(--ink-muted)',
              background: currentView === 'create' ? 'var(--paper-raised)' : 'transparent',
              border: currentView === 'create' ? 'var(--border-rule)' : '1px solid transparent',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <PlusCircle size={15} />
            Compile & Create
          </button>

          <button
            onClick={() => setCurrentView('precedents')}
            style={{
              padding: '6px 14px',
              borderRadius: 'var(--radius-control)',
              fontSize: 'var(--t-control)',
              fontWeight: 600,
              color: currentView === 'precedents' ? 'var(--ink)' : 'var(--ink-muted)',
              background: currentView === 'precedents' ? 'var(--paper-raised)' : 'transparent',
              border: currentView === 'precedents' ? 'var(--border-rule)' : '1px solid transparent',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <ShieldCheck size={15} />
            Precedent Registry
          </button>

          <button
            onClick={() => setCurrentView('charter')}
            style={{
              padding: '6px 14px',
              borderRadius: 'var(--radius-control)',
              fontSize: 'var(--t-control)',
              fontWeight: 600,
              color: currentView === 'charter' ? 'var(--ink)' : 'var(--ink-muted)',
              background: currentView === 'charter' ? 'var(--paper-raised)' : 'transparent',
              border: currentView === 'charter' ? 'var(--border-rule)' : '1px solid transparent',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <BookOpen size={15} />
            Charter v1
          </button>
        </nav>

        {/* Right side controls: network badge, theme toggle, wallet */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.72rem',
            padding: '4px 10px',
            borderRadius: 'var(--radius-control)',
            border: 'var(--border-rule)',
            background: 'var(--paper-sunk)',
            color: 'var(--sage)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}>
            <span style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              backgroundColor: 'var(--sage)',
              display: 'inline-block',
            }} />
            StudioNet 61999
          </div>

          <button
            onClick={toggleTheme}
            title="Toggle theme"
            style={{
              padding: 6,
              borderRadius: 'var(--radius-control)',
              border: 'var(--border-rule)',
              background: 'var(--paper-raised)',
              color: 'var(--ink)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </button>

          {ready && authenticated ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 12px',
                borderRadius: 'var(--radius-control)',
                background: 'var(--paper-raised)',
                border: 'var(--border-rule)',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--t-machine)',
              }}>
                <Wallet size={14} color="var(--sage)" />
                <span>{shortAddress || user.email?.address || 'Connected'}</span>
                {userBalance && (
                  <span style={{ color: 'var(--ink-muted)', borderLeft: 'var(--border-rule)', paddingLeft: 8 }}>
                    {formatGen(userBalance)} GEN
                  </span>
                )}
              </div>
              <button
                onClick={logout}
                title="Disconnect"
                style={{
                  padding: 6,
                  borderRadius: 'var(--radius-control)',
                  border: 'var(--border-rule)',
                  background: 'var(--paper-raised)',
                  color: 'var(--ink-muted)',
                }}
              >
                <LogOut size={14} />
              </button>
            </div>
          ) : (
            <button
              onClick={login}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 14px',
                borderRadius: 'var(--radius-control)',
                background: 'var(--ink)',
                color: 'var(--paper)',
                fontSize: 'var(--t-control)',
                fontWeight: 600,
              }}
            >
              <LogIn size={14} />
              Connect
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
