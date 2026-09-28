import React, { useState, useEffect } from 'react';
import { BookOpen, Shield, Scale, Clock, Layers, FileCode, CheckCircle2, ChevronRight } from 'lucide-react';
import { CONTRACTS } from '../lib/contracts';

export default function CharterPage() {
  const [charterData, setCharterData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchCharter = async () => {
      try {
        const res = await fetch('/api/charter');
        if (res.ok) {
          const data = await res.json();
          setCharterData(data);
        }
      } catch (e) {
        console.warn('Could not load charter API:', e);
      } finally {
        setLoading(false);
      }
    };
    fetchCharter();
  }, []);

  return (
    <div style={{ maxWidth: 1040, margin: '0 auto', padding: '32px 24px' }}>
      {/* Title */}
      <div style={{ marginBottom: 36, borderBottom: 'var(--border-rule)', paddingBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <BookOpen size={20} color="var(--sage)" />
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--t-machine)',
            color: 'var(--ink-muted)',
            letterSpacing: '0.05em',
          }}>
            GENLAYER INTELLIGENT RULEBOOK
          </span>
        </div>

        <h1 style={{
          fontFamily: 'var(--font-slab)',
          fontSize: 'var(--t-display)',
          fontWeight: 700,
          lineHeight: 1.05,
          color: 'var(--ink)',
        }}>
          The Vantage Charter (v1)
        </h1>
        <p style={{ color: 'var(--ink-muted)', fontSize: '1rem', marginTop: 10, maxWidth: 680 }}>
          The constitution of the prediction protocol. Published as an immutable intelligent contract at{' '}
          <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>{CONTRACTS.charter}</code>.
          Rules cannot be altered under open financial positions.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
        {/* Section 1: Precedence & Source Ranking */}
        <div className="legal-panel">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <Scale size={18} color="var(--sage)" />
            <h2 style={{ fontFamily: 'var(--font-slab)', fontSize: '1.35rem', fontWeight: 600 }}>
              1. Information Source Ranking & Hierarchy
            </h2>
          </div>
          <p style={{ color: 'var(--ink-muted)', fontSize: '0.9rem', marginBottom: 16 }}>
            When resolving evidence across disparate web APIs, GenLayer consensus nodes rank sources by institutional reliability:
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{
              padding: 14,
              background: 'var(--paper-sunk)',
              borderRadius: 'var(--radius-control)',
              border: 'var(--border-rule)',
            }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem', fontWeight: 600, color: 'var(--forest)' }}>
                TIER 1 — PRIMARY AUTHORITIES
              </div>
              <div style={{ fontSize: '0.85rem', marginTop: 4, color: 'var(--ink)' }}>
                Government statistical bureaus, official league registries, blockchain execution state (direct RPCs), and central banks.
              </div>
            </div>

            <div style={{
              padding: 14,
              background: 'var(--paper-sunk)',
              borderRadius: 'var(--radius-control)',
              border: 'var(--border-rule)',
            }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem', fontWeight: 600, color: 'var(--ink)' }}>
                TIER 2 — INSTITUTIONAL AGGREGATORS
              </div>
              <div style={{ fontSize: '0.85rem', marginTop: 4, color: 'var(--ink)' }}>
                Regulated price oracles, major financial aggregators (e.g. CoinGecko, CoinMarketCap, Bloomberg, Reuters), and standardized market APIs.
              </div>
            </div>

            <div style={{
              padding: 14,
              background: 'var(--paper-sunk)',
              borderRadius: 'var(--radius-control)',
              border: 'var(--border-rule)',
            }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem', fontWeight: 600, color: 'var(--ink-muted)' }}>
                TIER 3 — SECONDARY REPORTERS
              </div>
              <div style={{ fontSize: '0.85rem', marginTop: 4, color: 'var(--ink)' }}>
                Reputable journalistic outlets and specialized public reporting. Permitted only if whitelisted during initial market compilation.
              </div>
            </div>
          </div>
        </div>

        {/* Section 2: Quorum & Numeric Tolerance */}
        <div className="legal-panel">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <Layers size={18} color="var(--sage)" />
            <h2 style={{ fontFamily: 'var(--font-slab)', fontSize: '1.35rem', fontWeight: 600 }}>
              2. Quorum Thresholds & Equivalence Principles
            </h2>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 16,
            fontFamily: 'var(--font-mono)',
            fontSize: '0.84rem',
            marginBottom: 16,
          }}>
            <div style={{ background: 'var(--paper-sunk)', padding: 14, borderRadius: 'var(--radius-control)', border: 'var(--border-rule)' }}>
              <div style={{ color: 'var(--ink-muted)', fontSize: '0.70rem' }}>DEFAULT QUORUM</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 600, marginTop: 4 }}>k = 2 of n = 3</div>
              <div style={{ fontSize: '0.76rem', color: 'var(--ink-muted)', marginTop: 4 }}>
                At least 2 distinct web sources must agree on the extracted fact.
              </div>
            </div>

            <div style={{ background: 'var(--paper-sunk)', padding: 14, borderRadius: 'var(--radius-control)', border: 'var(--border-rule)' }}>
              <div style={{ color: 'var(--ink-muted)', fontSize: '0.70rem' }}>NUMERIC TOLERANCE BAND</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 600, marginTop: 4 }}>50 Basis Points (0.50%)</div>
              <div style={{ fontSize: '0.76rem', color: 'var(--ink-muted)', marginTop: 4 }}>
                Numeric values within 0.50% relative difference are treated as unanimous.
              </div>
            </div>

            <div style={{ background: 'var(--paper-sunk)', padding: 14, borderRadius: 'var(--radius-control)', border: 'var(--border-rule)' }}>
              <div style={{ color: 'var(--ink-muted)', fontSize: '0.70rem' }}>DUAL-RUN THRESHOLD</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 600, marginTop: 4 }}>10.0 GEN Open Interest</div>
              <div style={{ fontSize: '0.76rem', color: 'var(--ink-muted)', marginTop: 4 }}>
                High-volume markets require 2 independent non-deterministic passes before provisional ruling.
              </div>
            </div>
          </div>
        </div>

        {/* Section 3: Dispute Windows & Bonds */}
        <div className="legal-panel">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <Clock size={18} color="var(--sage)" />
            <h2 style={{ fontFamily: 'var(--font-slab)', fontSize: '1.35rem', fontWeight: 600 }}>
              3. Dispute Protocol & Bond Economics
            </h2>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: '0.88rem' }}>
            <p style={{ color: 'var(--ink-muted)' }}>
              Every provisional outcome is locked behind strict statutory review windows:
            </p>

            <ul style={{ paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <li>
                <strong>Challenge Window (24 hours):</strong> Any actor can challenge a provisional ruling by posting a <strong>0.01 GEN bond</strong> and an authoritative evidence URL. If the challenge flips the ruling, the challenger receives their bond back plus court rewards.
              </li>
              <li>
                <strong>Appeal Window (24 hours):</strong> If unsatisfied with challenge results, parties may request an appeal by posting a <strong>0.02 GEN bond</strong>, doubling the consensus validator set for a full recount.
              </li>
              <li>
                <strong>Author Bond:</strong> Creating a market requires an author bond (0.01 GEN). If a market is voided due to intentional ambiguity or manipulation, the author bond is slashed into the protocol Court Fund.
              </li>
              <li>
                <strong>Grace Period & Anti-Freeze Guarantee:</strong> If an oracle run ever fails to complete due to unforeseen external web outages, any user can trigger <code style={{ fontFamily: 'var(--font-mono)' }}>void_expired()</code> after the grace deadline, issuing 100% pro-rata collateral refunds.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
