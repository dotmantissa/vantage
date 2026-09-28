import React from 'react';
import { Lock, FileCheck, Globe, Hash, CheckCircle, AlertTriangle } from 'lucide-react';

/**
 * The Compiled Spec Sheet component (Core structural device from DESIGN_TOKENS.md)
 * Plain English on the left in slab serif, vertical hairline with seal lock, compiled machine spec on the right in mono.
 */
export default function CompiledSpecSheet({ market, onClick, interactive = false }) {
  if (!market) return null;

  const outcomes = Array.isArray(market.outcomes) ? market.outcomes : [];
  const sources = Array.isArray(market.sources) ? market.sources : [];
  const tags = Array.isArray(market.tags) ? market.tags : [];
  const prices = Array.isArray(market.prices_bps) ? market.prices_bps : [];

  return (
    <div
      onClick={interactive ? onClick : undefined}
      style={{
        background: 'var(--paper-raised)',
        border: 'var(--border-rule)',
        borderRadius: 'var(--radius-panel)',
        padding: '24px',
        cursor: interactive ? 'pointer' : 'default',
        transition: 'transform var(--dur-quick) var(--ease-doc), border-color var(--dur-quick) var(--ease-doc)',
        position: 'relative',
        marginBottom: '20px',
      }}
      className="spec-sheet-container"
    >
      {/* Top Meta Line: Market ID, State Badge, Tags */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 12,
        marginBottom: 18,
        borderBottom: 'var(--border-rule)',
        paddingBottom: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--t-machine)',
            color: 'var(--ink-muted)',
          }}>
            #{market.market_id}
          </span>
          <span className={`state-pill state-${(market.state || 'OPEN').toLowerCase()}`}>
            {market.state || 'OPEN'}
          </span>
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--t-machine)',
            color: 'var(--ink-muted)',
            textTransform: 'uppercase',
          }}>
            [{market.predicate_type || 'event'}]
          </span>
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {tags.slice(0, 4).map((t, idx) => (
            <span
              key={idx}
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.70rem',
                padding: '2px 6px',
                borderRadius: 'var(--radius-control)',
                background: 'var(--paper-sunk)',
                color: 'var(--ink-muted)',
                border: 'var(--border-rule)',
              }}
            >
              #{t}
            </span>
          ))}
        </div>
      </div>

      {/* The Asymmetric Spec Grid: Prose on Left, Seal Lock Midpoint, Machine on Right */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 56%) 32px minmax(0, 44%)',
        gap: 16,
        alignItems: 'stretch',
      }}>
        {/* Left: The Human Question in Zilla Slab */}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <h3 style={{
              fontFamily: 'var(--font-slab)',
              fontSize: 'var(--t-question)',
              fontWeight: 600,
              lineHeight: 1.25,
              color: 'var(--ink)',
              marginBottom: 12,
            }}>
              {market.question}
            </h3>

            {market.restated_question && market.restated_question !== market.question && (
              <p style={{
                fontSize: '0.88rem',
                color: 'var(--ink-muted)',
                lineHeight: 1.5,
                fontStyle: 'italic',
                marginBottom: 16,
              }}>
                Restated for precision: "{market.restated_question}"
              </p>
            )}
          </div>

          {/* Outcome Probabilities / Current AMM Prices */}
          <div style={{ marginTop: 16 }}>
            <div style={{
              fontSize: '0.78rem',
              fontWeight: 600,
              color: 'var(--ink-muted)',
              marginBottom: 8,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}>
              Outcomes & Implied Probabilities
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {outcomes.map((label, idx) => {
                const bps = prices[idx] || (outcomes.length ? Math.round(10000 / outcomes.length) : 5000);
                const pct = (bps / 100).toFixed(1);
                const isWinner = market.winning_outcome === idx;
                return (
                  <div
                    key={idx}
                    style={{
                      padding: '8px 14px',
                      borderRadius: 'var(--radius-control)',
                      background: isWinner ? 'var(--forest)' : 'var(--paper-sunk)',
                      color: isWinner ? 'var(--paper)' : 'var(--ink)',
                      border: isWinner ? '1px solid var(--forest)' : 'var(--border-rule)',
                      display: 'flex',
                      flexDirection: 'column',
                      minWidth: 100,
                    }}
                  >
                    <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>{label}</span>
                    <span style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '1.1rem',
                      fontWeight: 700,
                      marginTop: 2,
                    }}>
                      {pct}%
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Midpoint: Vertical Hairline with Seal Lock Icon */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
        }}>
          <div style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            width: 1,
            backgroundColor: 'var(--hairline)',
          }} />
          <div style={{
            zIndex: 2,
            background: 'var(--paper-raised)',
            border: 'var(--border-rule)',
            borderRadius: '50%',
            padding: 6,
            color: 'var(--ink-muted)',
          }}>
            <Lock size={14} />
          </div>
        </div>

        {/* Right: The Compiled Machine Predicate in JetBrains Mono */}
        <div style={{
          background: 'var(--paper-sunk)',
          borderRadius: 'var(--radius-control)',
          border: 'var(--border-rule)',
          padding: 16,
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--t-machine)',
          color: 'var(--ink)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
        }}>
          <div>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              color: 'var(--sage)',
              fontWeight: 600,
              marginBottom: 10,
              fontSize: '0.72rem',
              letterSpacing: '0.04em',
            }}>
              <FileCheck size={13} />
              MACHINE VERIFIED SPEC
            </div>

            <div style={{ marginBottom: 10 }}>
              <div style={{ color: 'var(--ink-muted)', fontSize: '0.70rem' }}>PREDICATE</div>
              <div style={{ wordBreak: 'break-word', marginTop: 2, fontWeight: 500 }}>
                {market.predicate || 'Event outcome verification via deterministic consensus'}
              </div>
            </div>

            {market.threshold && (
              <div style={{ marginBottom: 10, display: 'flex', gap: 16 }}>
                <div>
                  <div style={{ color: 'var(--ink-muted)', fontSize: '0.70rem' }}>COMPARATOR</div>
                  <div style={{ marginTop: 2 }}>{market.comparator || 'gte'}</div>
                </div>
                <div>
                  <div style={{ color: 'var(--ink-muted)', fontSize: '0.70rem' }}>THRESHOLD</div>
                  <div style={{ marginTop: 2 }}>{market.threshold} {market.units}</div>
                </div>
              </div>
            )}

            <div style={{ marginBottom: 10 }}>
              <div style={{ color: 'var(--ink-muted)', fontSize: '0.70rem', display: 'flex', alignItems: 'center', gap: 4 }}>
                <Globe size={11} />
                AUTHORIZED SOURCES ({sources.length})
              </div>
              <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
                {sources.map((s, i) => (
                  <div key={i} style={{ color: 'var(--ink-muted)', fontSize: '0.72rem' }}>
                    • {s}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div style={{
            borderTop: 'var(--border-rule)',
            paddingTop: 8,
            marginTop: 10,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '0.68rem',
            color: 'var(--ink-muted)',
          }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Hash size={11} />
              {market.spec_hash ? `${market.spec_hash.slice(0, 10)}...${market.spec_hash.slice(-6)}` : 'GEN-SPEC-LOCKED'}
            </span>
            <span>Charter {market.charter_version || 'v1'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
