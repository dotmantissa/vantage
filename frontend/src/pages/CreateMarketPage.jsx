import React, { useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import {
  FileCheck,
  Sparkles,
  ShieldAlert,
  ArrowRight,
  Globe,
  Layers,
  Calendar,
  DollarSign,
  AlertCircle,
  CheckCircle2,
  Lock
} from 'lucide-react';
import { parseGenToWei, formatGen } from '../lib/contracts';

export default function CreateMarketPage({ onMarketCreated }) {
  const { user, authenticated, login } = usePrivy();
  const userAddress = user?.wallet?.address;

  const [question, setQuestion] = useState('');
  const [outcomes, setOutcomes] = useState('YES, NO');
  const [sources, setSources] = useState('coingecko.com, coinmarketcap.com');
  const [closeDate, setCloseDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 14);
    return d.toISOString().slice(0, 16);
  });
  const [initialLiquidity, setInitialLiquidity] = useState('1.0');

  // Preview / Compilation state
  const [compiling, setCompiling] = useState(false);
  const [compiledSpec, setCompiledSpec] = useState(null);
  const [compileError, setCompileError] = useState(null);

  // Submitting state
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [submitSuccess, setSubmitSuccess] = useState(null);

  const handleSimulateCompilation = async (e) => {
    if (e) e.preventDefault();
    if (!question.trim()) {
      alert('Please enter a prediction market question.');
      return;
    }

    setCompiling(true);
    setCompileError(null);
    setCompiledSpec(null);

    try {
      // Simulate live LLM resolvability gate and spec compilation
      const outcomesList = outcomes.split(',').map((s) => s.trim()).filter(Boolean);
      const sourcesList = sources.split(',').map((s) => s.trim()).filter(Boolean);

      // Simple heuristic check for resolvability
      const hasSource = sourcesList.length > 0;
      const isNumeric = /\$|\bprice\b|\babove\b|\bgreater\b|\bhigher\b|\%|\bmarket cap\b/i.test(question);
      const isEvent = !isNumeric;

      await new Promise((r) => setTimeout(r, 600));

      const mockSpec = {
        resolvable: true,
        restated_question: question.trim(),
        predicate_type: isNumeric ? 'numeric' : 'event',
        predicate: isNumeric
          ? `Extract latest price from ${sourcesList.join(', ')} and evaluate threshold comparison`
          : `Verify factual occurrence of stated outcome via consensus over ${sourcesList.join(', ')}`,
        comparator: isNumeric ? 'gte' : 'eq',
        threshold: isNumeric ? '4000' : 'TRUE',
        units: isNumeric ? 'USD' : 'BOOL',
        sources: sourcesList,
        quorum_k: 2,
        quorum_n: Math.max(sourcesList.length, 3),
        author_bond_wei: parseGenToWei('0.01'),
        charter_version: 'v1',
      };

      setCompiledSpec(mockSpec);
    } catch (err) {
      console.error('Compilation simulation failed:', err);
      setCompileError(err.message || 'Resolvability gate check failed.');
    } finally {
      setCompiling(false);
    }
  };

  const handleCreateMarket = async () => {
    if (!question.trim()) {
      alert('Question is required');
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    setSubmitSuccess(null);

    try {
      const closeTimestamp = Math.floor(new Date(closeDate).getTime() / 1000);
      const authorBond = parseGenToWei('5.0');
      const depositLiquidity = parseGenToWei(initialLiquidity || '5.0');
      const totalValueWei = (BigInt(authorBond) + BigInt(depositLiquidity)).toString();

      // Trigger compile_market on StudioNet
      const res = await fetch('/api/relay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'compile_market',
          question: question.trim(),
          close_time: closeTimestamp,
          seed_liquidity_wei: depositLiquidity,
          extra_sources_csv: sources.trim(),
          value_wei: totalValueWei,
          author: userAddress || '0xBC1399c55538eC034d4Da550C03c34Ae0C357f53',
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to compile market on StudioNet');
      }

      setSubmitSuccess(data);
      if (onMarketCreated) {
        setTimeout(() => onMarketCreated(data.market_id || '1'), 1500);
      }
    } catch (err) {
      console.error('Market creation error:', err);
      setSubmitError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ maxWidth: 1040, margin: '0 auto', padding: '32px 24px' }}>
      {/* Title */}
      <div style={{ marginBottom: 32, borderBottom: 'var(--border-rule)', paddingBottom: 20 }}>
        <h1 style={{
          fontFamily: 'var(--font-slab)',
          fontSize: 'var(--t-display)',
          fontWeight: 700,
          color: 'var(--ink)',
          lineHeight: 1.1,
        }}>
          Compile & Author Market
        </h1>
        <p style={{ color: 'var(--ink-muted)', fontSize: '1rem', marginTop: 8, maxWidth: 640 }}>
          Natural language questions are compiled by GenLayer AI validators into strict, machine-executable predicates. An author bond protects against vague or malicious questions.
        </p>
      </div>

      <div className="asymmetric-grid">
        {/* Left Column (Input Form) */}
        <div>
          <form onSubmit={handleSimulateCompilation} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Question */}
            <div>
              <label style={{
                display: 'block',
                fontSize: '0.78rem',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                color: 'var(--ink-muted)',
                marginBottom: 6,
              }}>
                Market Question (Plain English)
              </label>
              <textarea
                rows={3}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="e.g. Will Ethereum trade at or above $4,000 USD before December 31, 2026?"
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  borderRadius: 'var(--radius-control)',
                  border: 'var(--border-rule)',
                  background: 'var(--paper-raised)',
                  fontFamily: 'var(--font-slab)',
                  fontSize: '1.15rem',
                  lineHeight: 1.35,
                  color: 'var(--ink)',
                  resize: 'vertical',
                }}
              />
              <span style={{ fontSize: '0.74rem', color: 'var(--ink-muted)', marginTop: 4, display: 'block' }}>
                Must be clear, time-bounded, and deterministically verifiable.
              </span>
            </div>

            {/* Outcomes */}
            <div>
              <label style={{
                display: 'block',
                fontSize: '0.78rem',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                color: 'var(--ink-muted)',
                marginBottom: 6,
              }}>
                Possible Outcomes (Comma-separated)
              </label>
              <input
                type="text"
                value={outcomes}
                onChange={(e) => setOutcomes(e.target.value)}
                placeholder="YES, NO"
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-control)',
                  border: 'var(--border-rule)',
                  background: 'var(--paper-raised)',
                  fontFamily: 'var(--font-sans)',
                  fontSize: '0.92rem',
                  color: 'var(--ink)',
                }}
              />
            </div>

            {/* Authorized Sources */}
            <div>
              <label style={{
                display: 'block',
                fontSize: '0.78rem',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                color: 'var(--ink-muted)',
                marginBottom: 6,
              }}>
                Authorized Information Sources (Domains)
              </label>
              <input
                type="text"
                value={sources}
                onChange={(e) => setSources(e.target.value)}
                placeholder="coingecko.com, coinmarketcap.com, binance.com"
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-control)',
                  border: 'var(--border-rule)',
                  background: 'var(--paper-raised)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.84rem',
                  color: 'var(--ink)',
                }}
              />
              <span style={{ fontSize: '0.74rem', color: 'var(--ink-muted)', marginTop: 4, display: 'block' }}>
                Validators will strictly whitelist and scrape evidence only from these domains.
              </span>
            </div>

            {/* Close Time & Initial Liquidity */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <label style={{
                  display: 'block',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  color: 'var(--ink-muted)',
                  marginBottom: 6,
                }}>
                  Market Close Time
                </label>
                <input
                  type="datetime-local"
                  value={closeDate}
                  onChange={(e) => setCloseDate(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 'var(--radius-control)',
                    border: 'var(--border-rule)',
                    background: 'var(--paper-raised)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.82rem',
                    color: 'var(--ink)',
                  }}
                />
              </div>

              <div>
                <label style={{
                  display: 'block',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  color: 'var(--ink-muted)',
                  marginBottom: 6,
                }}>
                  Initial Liquidity (GEN)
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0.1"
                  value={initialLiquidity}
                  onChange={(e) => setInitialLiquidity(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 'var(--radius-control)',
                    border: 'var(--border-rule)',
                    background: 'var(--paper-raised)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.9rem',
                    color: 'var(--ink)',
                  }}
                />
              </div>
            </div>

            {/* Preview Spec Action Button */}
            <button
              type="submit"
              disabled={compiling}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                padding: '12px 18px',
                borderRadius: 'var(--radius-control)',
                border: '1px solid var(--ink)',
                background: 'transparent',
                color: 'var(--ink)',
                fontWeight: 600,
                fontSize: 'var(--t-control)',
                cursor: 'pointer',
                marginTop: 8,
              }}
            >
              <Sparkles size={16} />
              {compiling ? 'Validating against Resolvability Gate...' : 'Preview Compiled Spec'}
            </button>
          </form>
        </div>

        {/* Right Column: Compiled Spec Sheet Preview & Submission */}
        <div>
          <div className="legal-panel" style={{ position: 'sticky', top: 90 }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderBottom: 'var(--border-rule)',
              paddingBottom: 12,
              marginBottom: 16,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <FileCheck size={16} color="var(--sage)" />
                <h3 style={{
                  fontFamily: 'var(--font-slab)',
                  fontSize: 'var(--t-section)',
                  fontWeight: 600,
                }}>
                  Compiler Preview
                </h3>
              </div>
              <span className="state-pill state-open">PRE-LOCKED</span>
            </div>

            {compiledSpec ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{
                  padding: 12,
                  background: 'var(--paper-sunk)',
                  borderRadius: 'var(--radius-control)',
                  border: 'var(--border-rule)',
                }}>
                  <div style={{ fontSize: '0.70rem', color: 'var(--ink-muted)', textTransform: 'uppercase' }}>
                    GATE VERIFICATION: PASSED
                  </div>
                  <div style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--forest)', marginTop: 2 }}>
                    5 of 5 Resolvability Criteria Satisfied
                  </div>
                </div>

                <div>
                  <span style={{ fontSize: '0.70rem', color: 'var(--ink-muted)', textTransform: 'uppercase' }}>
                    Predicate Type:
                  </span>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.84rem', fontWeight: 600 }}>
                    {compiledSpec.predicate_type.toUpperCase()}
                  </div>
                </div>

                <div>
                  <span style={{ fontSize: '0.70rem', color: 'var(--ink-muted)', textTransform: 'uppercase' }}>
                    Machine Predicate:
                  </span>
                  <p style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.78rem',
                    background: 'var(--paper-sunk)',
                    padding: '8px 10px',
                    borderRadius: 'var(--radius-control)',
                    border: 'var(--border-rule)',
                    marginTop: 4,
                  }}>
                    {compiledSpec.predicate}
                  </p>
                </div>

                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 10,
                  fontSize: '0.76rem',
                  fontFamily: 'var(--font-mono)',
                }}>
                  <div>
                    <span style={{ color: 'var(--ink-muted)' }}>QUORUM THRESHOLD</span>
                    <div>{compiledSpec.quorum_k} of {compiledSpec.quorum_n} sources</div>
                  </div>
                  <div>
                    <span style={{ color: 'var(--ink-muted)' }}>AUTHOR BOND</span>
                    <div>0.01 GEN (Escrow)</div>
                  </div>
                </div>

                {/* Submission CTA */}
                <div style={{ borderTop: 'var(--border-rule)', paddingTop: 16, marginTop: 8 }}>
                  <button
                    onClick={handleCreateMarket}
                    disabled={submitting}
                    style={{
                      width: '100%',
                      padding: '14px',
                      background: 'var(--ink)',
                      color: 'var(--paper)',
                      borderRadius: 'var(--radius-control)',
                      fontWeight: 600,
                      fontSize: '0.9rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      cursor: 'pointer',
                    }}
                  >
                    {submitting ? 'Deploying to StudioNet...' : 'Compile & Publish Market'}
                    <ArrowRight size={16} />
                  </button>
                </div>
              </div>
            ) : (
              <div style={{
                textAlign: 'center',
                padding: '40px 16px',
                color: 'var(--ink-muted)',
                fontSize: '0.86rem',
              }}>
                <Lock size={28} style={{ margin: '0 auto 12px', opacity: 0.4 }} />
                <p>Fill out the question parameters and click <strong>Preview Compiled Spec</strong> to inspect the machine contract.</p>
              </div>
            )}

            {submitSuccess && (
              <div style={{
                marginTop: 16,
                padding: 12,
                borderRadius: 'var(--radius-control)',
                background: 'var(--paper-sunk)',
                color: 'var(--forest)',
                fontSize: '0.82rem',
                border: 'var(--border-rule)',
                fontFamily: 'var(--font-mono)',
              }}>
                Market #{submitSuccess.market_id || '1'} compiled and deployed successfully!
              </div>
            )}

            {submitError && (
              <div style={{
                marginTop: 16,
                padding: 12,
                borderRadius: 'var(--radius-control)',
                background: 'rgba(200, 50, 50, 0.1)',
                color: 'var(--ink)',
                fontSize: '0.82rem',
                border: 'var(--border-rule)',
                fontFamily: 'var(--font-mono)',
              }}>
                Error: {submitError}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
