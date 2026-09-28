import React, { useState, useEffect } from 'react';
import CompiledSpecSheet from '../components/CompiledSpecSheet';
import { Search, Filter, Plus, ArrowUpDown, RefreshCw } from 'lucide-react';

export default function MarketsPage({ onSelectMarket, onNavigateCreate }) {
  const [markets, setMarkets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filterState, setFilterState] = useState('ALL');
  const [selectedTag, setSelectedTag] = useState('');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('newest');

  const fetchMarkets = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filterState !== 'ALL') params.append('status', filterState);
      if (selectedTag) params.append('tag', selectedTag);
      if (search) params.append('search', search);
      if (sortBy) params.append('sort', sortBy);

      const res = await fetch(`/api/markets?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setMarkets(data.markets || []);
    } catch (err) {
      console.error('Failed to load markets:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMarkets();
  }, [filterState, selectedTag, sortBy]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    fetchMarkets();
  };

  const statusFilters = ['ALL', 'OPEN', 'PROVISIONAL', 'CHALLENGED', 'FINAL', 'SETTLED', 'VOID'];
  const popularTags = ['crypto', 'ethereum', 'price', 'sports', 'macro', 'threshold'];

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 24px' }}>
      {/* Hero / Header */}
      <div style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 16,
        marginBottom: 32,
      }}>
        <div>
          <h1 style={{
            fontFamily: 'var(--font-slab)',
            fontSize: 'var(--t-display)',
            fontWeight: 700,
            lineHeight: 1.05,
            letterSpacing: '-0.02em',
            color: 'var(--ink)',
          }}>
            Prediction Markets
          </h1>
          <p style={{
            color: 'var(--ink-muted)',
            fontSize: '1rem',
            marginTop: 6,
            maxWidth: 620,
          }}>
            Every question is compiled into a machine-executable spec, settled by GenLayer Intelligent Contract consensus, and recorded into the immutable charter.
          </p>
        </div>

        <button
          onClick={onNavigateCreate}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 18px',
            background: 'var(--ink)',
            color: 'var(--paper)',
            borderRadius: 'var(--radius-control)',
            fontSize: 'var(--t-control)',
            fontWeight: 600,
            border: 'none',
          }}
        >
          <Plus size={16} />
          Compile New Market
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div style={{
        background: 'var(--paper-raised)',
        border: 'var(--border-rule)',
        borderRadius: 'var(--radius-panel)',
        padding: '16px 20px',
        marginBottom: 24,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
        }}>
          {/* Status Tabs */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {statusFilters.map((s) => (
              <button
                key={s}
                onClick={() => setFilterState(s)}
                style={{
                  padding: '5px 12px',
                  borderRadius: 'var(--radius-control)',
                  fontSize: 'var(--t-control)',
                  fontWeight: 600,
                  background: filterState === s ? 'var(--ink)' : 'transparent',
                  color: filterState === s ? 'var(--paper)' : 'var(--ink-muted)',
                  border: filterState === s ? '1px solid var(--ink)' : '1px solid var(--hairline)',
                }}
              >
                {s}
              </button>
            ))}
          </div>

          {/* Search Input */}
          <form onSubmit={handleSearchSubmit} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ position: 'relative' }}>
              <Search
                size={14}
                style={{
                  position: 'absolute',
                  left: 10,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--ink-muted)',
                }}
              />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search questions..."
                style={{
                  padding: '6px 12px 6px 30px',
                  borderRadius: 'var(--radius-control)',
                  border: 'var(--border-rule)',
                  background: 'var(--paper-sunk)',
                  color: 'var(--ink)',
                  fontSize: '0.85rem',
                  width: 240,
                }}
              />
            </div>

            <button
              type="submit"
              style={{
                padding: '6px 12px',
                borderRadius: 'var(--radius-control)',
                border: 'var(--border-rule)',
                background: 'var(--paper-sunk)',
                color: 'var(--ink)',
                fontSize: 'var(--t-control)',
                fontWeight: 600,
              }}
            >
              Filter
            </button>

            <button
              type="button"
              onClick={fetchMarkets}
              title="Refresh markets"
              style={{
                padding: '6px 8px',
                borderRadius: 'var(--radius-control)',
                border: 'var(--border-rule)',
                background: 'var(--paper-sunk)',
                color: 'var(--ink-muted)',
              }}
            >
              <RefreshCw size={14} />
            </button>
          </form>
        </div>

        {/* Popular Tags */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', borderTop: 'var(--border-rule)', paddingTop: 12 }}>
          <span style={{ fontSize: '0.74rem', color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            TAGS:
          </span>
          <button
            onClick={() => setSelectedTag('')}
            style={{
              padding: '2px 8px',
              borderRadius: 'var(--radius-control)',
              fontSize: '0.74rem',
              fontFamily: 'var(--font-mono)',
              background: selectedTag === '' ? 'var(--paper-sunk)' : 'transparent',
              color: selectedTag === '' ? 'var(--ink)' : 'var(--ink-muted)',
              border: selectedTag === '' ? 'var(--border-rule)' : '1px solid transparent',
            }}
          >
            All tags
          </button>
          {popularTags.map((tag) => (
            <button
              key={tag}
              onClick={() => setSelectedTag(selectedTag === tag ? '' : tag)}
              style={{
                padding: '2px 8px',
                borderRadius: 'var(--radius-control)',
                fontSize: '0.74rem',
                fontFamily: 'var(--font-mono)',
                background: selectedTag === tag ? 'var(--paper-sunk)' : 'transparent',
                color: selectedTag === tag ? 'var(--ink)' : 'var(--ink-muted)',
                border: selectedTag === tag ? 'var(--border-rule)' : '1px solid transparent',
              }}
            >
              #{tag}
            </button>
          ))}
        </div>
      </div>

      {/* Markets List */}
      {loading ? (
        <div style={{
          textAlign: 'center',
          padding: '60px 0',
          color: 'var(--ink-muted)',
          fontFamily: 'var(--font-mono)',
        }}>
          Loading live markets from StudioNet indexer...
        </div>
      ) : error ? (
        <div style={{
          padding: 24,
          background: 'var(--paper-raised)',
          border: '1px solid var(--hairline)',
          borderRadius: 'var(--radius-panel)',
          color: 'var(--ink)',
          textAlign: 'center',
        }}>
          Error loading markets: {error}
        </div>
      ) : markets.length === 0 ? (
        <div style={{
          padding: '64px 24px',
          textAlign: 'center',
          background: 'var(--paper-raised)',
          border: 'var(--border-rule)',
          borderRadius: 'var(--radius-panel)',
        }}>
          <h3 style={{ fontFamily: 'var(--font-slab)', fontSize: '1.4rem', color: 'var(--ink)', marginBottom: 8 }}>
            No markets found
          </h3>
          <p style={{ color: 'var(--ink-muted)', fontSize: '0.9rem', maxWidth: 440, margin: '0 auto 20px' }}>
            Be the first to author and compile a market with automated oracle resolution.
          </p>
          <button
            onClick={onNavigateCreate}
            style={{
              padding: '8px 16px',
              background: 'var(--ink)',
              color: 'var(--paper)',
              borderRadius: 'var(--radius-control)',
              fontWeight: 600,
            }}
          >
            Create Market
          </button>
        </div>
      ) : (
        <div>
          {markets.map((m) => (
            <CompiledSpecSheet
              key={m.market_id}
              market={m}
              onClick={() => onSelectMarket(m.market_id)}
              interactive={true}
            />
          ))}
        </div>
      )}
    </div>
  );
}
