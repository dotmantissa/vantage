import React, { useState, useEffect } from 'react';
import { ShieldCheck, Search, Tag, ExternalLink, Hash, BookOpen } from 'lucide-react';
import { formatDateTime } from '../lib/contracts';

export default function PrecedentsPage({ onSelectMarket }) {
  const [precedents, setPrecedents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [selectedTag, setSelectedTag] = useState('');

  const fetchPrecedents = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (selectedTag) params.append('tag', selectedTag);
      if (search) params.append('search', search);

      const res = await fetch(`/api/precedents?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setPrecedents(data.precedents || []);
    } catch (err) {
      console.error('Failed to load precedents:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPrecedents();
  }, [selectedTag]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    fetchPrecedents();
  };

  const commonTags = ['crypto', 'sports', 'macro', 'price', 'ambiguity', 'numeric'];

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 24px' }}>
      {/* Title Header */}
      <div style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 16,
        marginBottom: 28,
        borderBottom: 'var(--border-rule)',
        paddingBottom: 20,
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <ShieldCheck size={20} color="var(--sage)" />
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--t-machine)',
              color: 'var(--ink-muted)',
              letterSpacing: '0.05em',
            }}>
              VANTAGE PRECEDENT REGISTRY
            </span>
          </div>

          <h1 style={{
            fontFamily: 'var(--font-slab)',
            fontSize: 'var(--t-display)',
            fontWeight: 700,
            lineHeight: 1.1,
            color: 'var(--ink)',
          }}>
            Precedents & Rulings
          </h1>
          <p style={{ color: 'var(--ink-muted)', fontSize: '1rem', marginTop: 8, maxWidth: 640 }}>
            Finalized rulings from challenged, appealed, or ambiguous markets are permanently inscribed into the Charter as case law for future AI validator consensus.
          </p>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div style={{
        background: 'var(--paper-raised)',
        border: 'var(--border-rule)',
        borderRadius: 'var(--radius-panel)',
        padding: '16px 20px',
        marginBottom: 24,
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.74rem', color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              TAG FILTER:
            </span>
            <button
              onClick={() => setSelectedTag('')}
              style={{
                padding: '3px 8px',
                borderRadius: 'var(--radius-control)',
                fontSize: '0.74rem',
                fontFamily: 'var(--font-mono)',
                background: selectedTag === '' ? 'var(--paper-sunk)' : 'transparent',
                color: selectedTag === '' ? 'var(--ink)' : 'var(--ink-muted)',
                border: selectedTag === '' ? 'var(--border-rule)' : '1px solid transparent',
              }}
            >
              All Tags
            </button>
            {commonTags.map((tag) => (
              <button
                key={tag}
                onClick={() => setSelectedTag(selectedTag === tag ? '' : tag)}
                style={{
                  padding: '3px 8px',
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

          <form onSubmit={handleSearchSubmit} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="text"
              placeholder="Search precedents..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                padding: '6px 12px',
                borderRadius: 'var(--radius-control)',
                border: 'var(--border-rule)',
                background: 'var(--paper-sunk)',
                color: 'var(--ink)',
                fontSize: '0.84rem',
                width: 220,
              }}
            />
            <button
              type="submit"
              style={{
                padding: '6px 12px',
                borderRadius: 'var(--radius-control)',
                background: 'var(--paper-sunk)',
                border: 'var(--border-rule)',
                fontSize: 'var(--t-control)',
                fontWeight: 600,
              }}
            >
              Search
            </button>
          </form>
        </div>
      </div>

      {/* Precedent Cards */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px 0', fontFamily: 'var(--font-mono)', color: 'var(--ink-muted)' }}>
          Loading precedent registry from Charter contract...
        </div>
      ) : error ? (
        <div className="legal-panel" style={{ textAlign: 'center', padding: 32 }}>
          Error loading precedents: {error}
        </div>
      ) : precedents.length === 0 ? (
        <div className="legal-panel" style={{ textAlign: 'center', padding: '60px 24px' }}>
          <BookOpen size={32} style={{ margin: '0 auto 12px', opacity: 0.4 }} />
          <h3 style={{ fontFamily: 'var(--font-slab)', fontSize: '1.3rem', marginBottom: 8 }}>
            No Precedents Inscribed Yet
          </h3>
          <p style={{ color: 'var(--ink-muted)', fontSize: '0.9rem', maxWidth: 480, margin: '0 auto' }}>
            When a challenged or ambiguous market completes settlement, its judgment is recorded here by the VantageMarket contract.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {precedents.map((p, idx) => {
            const tags = Array.isArray(p.tags) ? p.tags : (p.tags ? p.tags.split(',') : []);
            return (
              <div
                key={idx}
                className="legal-panel"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                }}
              >
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  borderBottom: 'var(--border-rule)',
                  paddingBottom: 10,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.74rem', color: 'var(--ink-muted)' }}>
                      #{p.precedent_id || `PREC-${idx + 1}`}
                    </span>
                    <span className="state-pill state-settled">
                      RULING FINAL
                    </span>
                    {p.reason_code && (
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--ink-muted)' }}>
                        REASON: {p.reason_code}
                      </span>
                    )}
                  </div>

                  {p.market_id && onSelectMarket && (
                    <button
                      onClick={() => onSelectMarket(p.market_id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        fontSize: 'var(--t-control)',
                        fontWeight: 600,
                        color: 'var(--sage)',
                      }}
                    >
                      View Market #{p.market_id} <ExternalLink size={13} />
                    </button>
                  )}
                </div>

                <div>
                  <h3 style={{
                    fontFamily: 'var(--font-slab)',
                    fontSize: '1.2rem',
                    fontWeight: 600,
                    color: 'var(--ink)',
                    marginBottom: 6,
                  }}>
                    {p.question || p.summary || 'Market Case Ruling'}
                  </h3>

                  {p.spec_pattern && (
                    <div style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.78rem',
                      background: 'var(--paper-sunk)',
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-control)',
                      border: 'var(--border-rule)',
                      color: 'var(--ink-muted)',
                      marginTop: 6,
                    }}>
                      PATTERN: {p.spec_pattern}
                    </div>
                  )}
                </div>

                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: 10,
                  borderTop: 'var(--border-rule)',
                  paddingTop: 10,
                  fontSize: '0.76rem',
                }}>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {tags.map((t, i) => (
                      <span
                        key={i}
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: '0.70rem',
                          padding: '2px 6px',
                          borderRadius: 'var(--radius-control)',
                          background: 'var(--paper-sunk)',
                          color: 'var(--ink-muted)',
                        }}
                      >
                        #{t}
                      </span>
                    ))}
                  </div>

                  <div style={{ color: 'var(--ink-muted)', fontFamily: 'var(--font-mono)' }}>
                    {p.created_at ? formatDateTime(p.created_at) : 'Charter Recorded'}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
