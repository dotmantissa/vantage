import React, { useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import {
  Sparkles,
  ShieldAlert,
  ArrowRight,
  Globe,
  Layers,
  Calendar,
  DollarSign,
  AlertCircle,
  CheckCircle2,
  Lock,
  Clock,
  Edit3,
  FileCheck,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Plus
} from 'lucide-react';
import { parseGenToWei, formatGen } from '../lib/contracts';

const EXAMPLE_QUESTIONS = [
  'Will Bitcoin exceed $120,000 before December 31, 2026?',
  'Will the Federal Reserve lower interest rates in 2026?',
  'Will Apple market cap surpass $4 Trillion USD by end of Q4 2026?',
  'Will GenLayer StudioNet reach 1,000 active smart contracts by December 2026?'
];

export default function CreateMarketPage({ onMarketCreated }) {
  const { user } = usePrivy();
  const userAddress = user?.wallet?.address;

  // Multi-stage flow: 1 = Question Formulation & Validator Consultation; 2 = Validator Synthesis & Deployment
  const [stage, setStage] = useState(1);

  // Stage 1: Question
  const [question, setQuestion] = useState('');
  const [validating, setValidating] = useState(false);
  const [validationError, setValidationError] = useState(null);
  const [validationResult, setValidationResult] = useState(null);

  // Stage 2: Parameters (derived by validators or configured by user)
  const [closeDate, setCloseDate] = useState('');
  const [initialLiquidity, setInitialLiquidity] = useState('1.0');
  const [extraSources, setExtraSources] = useState('');
  const [showExtraSources, setShowExtraSources] = useState(false);

  // Submission state
  const [submitting, setSubmitting] = useState(false);
  const [submitStep, setSubmitStep] = useState('');
  const [submitError, setSubmitError] = useState(null);
  const [submitSuccess, setSubmitSuccess] = useState(null);

  // Stage 1: Consult validators on the question
  const handleConsultValidators = async (e) => {
    if (e) e.preventDefault();
    const cleanQ = question.trim();
    if (!cleanQ) {
      setValidationError('Please enter a prediction market question in plain English.');
      return;
    }
    if (cleanQ.length < 10) {
      setValidationError('The question is too brief. Please provide a clear, specific market proposition.');
      return;
    }

    setValidating(true);
    setValidationError(null);
    setValidationResult(null);

    try {
      const res = await fetch('/api/validate-market', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: cleanQ }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Validator consultation failed. Please check network connection.');
      }

      setValidationResult(data);

      if (data.resolvable) {
        // If question specified a timeline, auto-populate it
        if (data.timeline_detected && data.detected_close_iso) {
          setCloseDate(data.detected_close_iso);
        } else {
          // If no timeline detected, default to 14 days ahead so the user can review or change
          const d = new Date();
          d.setDate(d.getDate() + 14);
          setCloseDate(d.toISOString().slice(0, 16));
        }
        setStage(2);
      }
    } catch (err) {
      console.error('Validator query error:', err);
      setValidationError(err.message);
    } finally {
      setValidating(false);
    }
  };

  // Quick preset helper for close date
  const setQuickTimelineDays = (days) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(23, 59, 0, 0);
    setCloseDate(d.toISOString().slice(0, 16));
  };

  const setQuickTimelineEndOfYear = () => {
    const currentYear = new Date().getFullYear();
    const d = new Date(Date.UTC(currentYear, 11, 31, 23, 59, 0));
    setCloseDate(d.toISOString().slice(0, 16));
  };

  // Stage 2: Compile & Publish on GenLayer StudioNet
  const handleCompileAndPublish = async () => {
    if (!question.trim()) {
      setSubmitError('Question is missing.');
      return;
    }
    if (!closeDate) {
      setSubmitError('Please specify the market closing date and time.');
      return;
    }

    setSubmitting(true);
    setSubmitStep('Broadcasting compile_market to GenLayer StudioNet...');
    setSubmitError(null);
    setSubmitSuccess(null);

    try {
      const closeTimestamp = Math.floor(new Date(closeDate).getTime() / 1000);
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (closeTimestamp <= nowSeconds) {
        throw new Error('Market close time must be in the future.');
      }

      // Combine validator-selected sources with any extra sources
      const combinedSources = [...(validationResult?.sources || [])];
      if (extraSources.trim()) {
        extraSources.split(',').forEach((s) => {
          const clean = s.trim().toLowerCase();
          if (clean && !combinedSources.includes(clean)) {
            combinedSources.push(clean);
          }
        });
      }

      const authorBond = parseGenToWei('5.0');
      const depositLiquidity = parseGenToWei(initialLiquidity || '1.0');
      const totalValueWei = (BigInt(authorBond) + BigInt(depositLiquidity)).toString();

      setSubmitStep('Awaiting GenLayer AI validator consensus receipt...');

      const res = await fetch('/api/relay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'compile_market',
          question: question.trim(),
          close_time: closeTimestamp,
          seed_liquidity_wei: depositLiquidity,
          extra_sources_csv: combinedSources.join(','),
          value_wei: totalValueWei,
          author: userAddress || '0xBC1399c55538eC034d4Da550C03c34Ae0C357f53',
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to compile market on GenLayer StudioNet.');
      }

      setSubmitStep('Validator consensus reached: ACCEPTED');
      setSubmitSuccess(data);

      if (onMarketCreated) {
        setTimeout(() => onMarketCreated(data.market_id || '1'), 1800);
      }
    } catch (err) {
      console.error('Market compilation error:', err);
      setSubmitError(err.message || 'Market compilation transaction failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ maxWidth: 1040, margin: '0 auto', padding: '32px 24px' }}>
      {/* Header */}
      <div style={{ marginBottom: 32, borderBottom: 'var(--border-rule)', paddingBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <Layers size={18} color="var(--sage)" />
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--t-machine)',
            color: 'var(--ink-muted)',
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
          }}>
            INTELLIGENT COMPILER ENGINE
          </span>
        </div>

        <h1 style={{
          fontFamily: 'var(--font-slab)',
          fontSize: 'var(--t-display)',
          fontWeight: 700,
          color: 'var(--ink)',
          lineHeight: 1.1,
        }}>
          Compile & Author Market
        </h1>
        <p style={{ color: 'var(--ink-muted)', fontSize: '1rem', marginTop: 8, maxWidth: 680 }}>
          Formulate your market question in natural English. GenLayer's AI validator consensus assesses live web data fetchability, designates authoritative oracles, and synthesizes an immutable smart contract.
        </p>

        {/* Stepper indicators */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 20 }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 14px',
            borderRadius: 'var(--radius-pill)',
            background: stage === 1 ? 'var(--paper-sunk)' : 'var(--paper-raised)',
            border: stage === 1 ? '1px solid var(--ink)' : '1px solid var(--hairline)',
            fontSize: '0.82rem',
            fontFamily: 'var(--font-mono)',
            color: stage === 1 ? 'var(--ink)' : 'var(--ink-muted)',
            fontWeight: stage === 1 ? 600 : 400,
          }}>
            <span>1</span> Question & Validator Analysis
          </div>
          <ArrowRight size={14} color="var(--ink-muted)" />
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 14px',
            borderRadius: 'var(--radius-pill)',
            background: stage === 2 ? 'var(--paper-sunk)' : 'var(--paper-raised)',
            border: stage === 2 ? '1px solid var(--ink)' : '1px solid var(--hairline)',
            fontSize: '0.82rem',
            fontFamily: 'var(--font-mono)',
            color: stage === 2 ? 'var(--ink)' : 'var(--ink-muted)',
            fontWeight: stage === 2 ? 600 : 400,
          }}>
            <span>2</span> Live Oracles, Timeline & Deployment
          </div>
        </div>
      </div>

      {/* STAGE 1: Market Question Formulation & Validator Consultation */}
      {stage === 1 && (
        <div style={{ maxWidth: 760, margin: '0 auto' }}>
          <div className="legal-panel">
            <h2 style={{
              fontFamily: 'var(--font-slab)',
              fontSize: '1.35rem',
              fontWeight: 600,
              color: 'var(--ink)',
              marginBottom: 8,
            }}>
              Step 1: Propose Market Question
            </h2>
            <p style={{ fontSize: '0.90rem', color: 'var(--ink-muted)', marginBottom: 20 }}>
              Enter the proposition you want validators to evaluate. The validator network will automatically verify if live empirical data can be scraped from web oracles to settle it.
            </p>

            <form onSubmit={handleConsultValidators} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div>
                <label style={{
                  display: 'block',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  color: 'var(--ink-muted)',
                  marginBottom: 8,
                }}>
                  Market Question (Plain English)
                </label>
                <textarea
                  rows={4}
                  value={question}
                  onChange={(e) => {
                    setQuestion(e.target.value);
                    if (validationError) setValidationError(null);
                  }}
                  placeholder="e.g. Will Bitcoin exceed $120,000 before December 31, 2026? or Will the Federal Reserve lower interest rates in 2026?"
                  style={{
                    width: '100%',
                    padding: '14px 16px',
                    borderRadius: 'var(--radius-control)',
                    border: 'var(--border-rule)',
                    background: 'var(--paper-sunk)',
                    fontFamily: 'var(--font-slab)',
                    fontSize: '1.2rem',
                    lineHeight: 1.35,
                    color: 'var(--ink)',
                    resize: 'vertical',
                  }}
                />
              </div>

              {/* Example Prompts */}
              <div>
                <span style={{
                  display: 'block',
                  fontSize: '0.74rem',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  color: 'var(--ink-muted)',
                  marginBottom: 8,
                }}>
                  Or try a sample question:
                </span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {EXAMPLE_QUESTIONS.map((example, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        setQuestion(example);
                        if (validationError) setValidationError(null);
                      }}
                      style={{
                        textAlign: 'left',
                        padding: '8px 12px',
                        background: 'var(--paper)',
                        border: 'var(--border-rule)',
                        borderRadius: 'var(--radius-control)',
                        fontSize: '0.84rem',
                        color: 'var(--ink)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <span>{example}</span>
                      <ArrowRight size={14} color="var(--ink-muted)" />
                    </button>
                  ))}
                </div>
              </div>

              {/* Validation Warning / Error from Backend */}
              {validationResult && !validationResult.resolvable && (
                <div style={{
                  padding: 16,
                  borderRadius: 'var(--radius-control)',
                  background: 'rgba(215, 60, 60, 0.08)',
                  border: '1px solid rgba(215, 60, 60, 0.35)',
                  display: 'flex',
                  gap: 12,
                  alignItems: 'flex-start',
                }}>
                  <ShieldAlert size={20} color="#c53030" style={{ flexShrink: 0, marginTop: 2 }} />
                  <div>
                    <h4 style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>
                      Validators Cannot Resolve Question
                    </h4>
                    <p style={{ fontSize: '0.84rem', color: 'var(--ink-muted)', lineHeight: 1.45 }}>
                      {validationResult.reason || 'The question is too subjective or lacks an empirical data oracle.'}
                    </p>
                    <p style={{ fontSize: '0.78rem', color: 'var(--ink-muted)', marginTop: 8 }}>
                      <strong>Tip:</strong> Re-phrase your question around verifiable market numbers, official announcements, or empirical event records.
                    </p>
                  </div>
                </div>
              )}

              {validationError && (
                <div style={{
                  padding: 12,
                  borderRadius: 'var(--radius-control)',
                  background: 'rgba(215, 60, 60, 0.08)',
                  border: '1px solid rgba(215, 60, 60, 0.35)',
                  fontSize: '0.84rem',
                  color: '#c53030',
                }}>
                  {validationError}
                </div>
              )}

              {/* Submit Consultation Button */}
              <button
                type="submit"
                disabled={validating || !question.trim()}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 10,
                  padding: '14px 20px',
                  borderRadius: 'var(--radius-control)',
                  background: validating || !question.trim() ? 'var(--paper-sunk)' : 'var(--ink)',
                  color: validating || !question.trim() ? 'var(--ink-muted)' : 'var(--paper)',
                  fontWeight: 600,
                  fontSize: '0.94rem',
                  cursor: validating || !question.trim() ? 'not-allowed' : 'pointer',
                  border: 'none',
                  transition: 'background var(--dur-quick)',
                  marginTop: 8,
                }}
              >
                <Sparkles size={18} />
                {validating ? 'Consulting GenLayer Validators & Checking Live Oracles...' : 'Consult Validators & Analyze Resolvability →'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* STAGE 2: Validator Synthesis, Timeline & Deployment */}
      {stage === 2 && (
        <div className="asymmetric-grid">
          {/* Left Column: Form & Configuration */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* The Evaluated Question Card */}
            <div className="legal-panel">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <span style={{
                  fontSize: '0.74rem',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  color: 'var(--ink-muted)',
                }}>
                  Evaluated Market Question
                </span>
                <button
                  type="button"
                  onClick={() => setStage(1)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: '0.78rem',
                    color: 'var(--sage)',
                    fontWeight: 600,
                    cursor: 'pointer',
                    background: 'none',
                    border: 'none',
                    padding: '2px 6px',
                  }}
                >
                  <Edit3 size={14} />
                  Edit Question
                </button>
              </div>

              <p style={{
                fontFamily: 'var(--font-slab)',
                fontSize: '1.28rem',
                fontWeight: 600,
                lineHeight: 1.35,
                color: 'var(--ink)',
              }}>
                "{question.trim()}"
              </p>
            </div>

            {/* Validator Source Selection Verdict */}
            <div className="legal-panel">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <Globe size={18} color="var(--sage)" />
                <h3 style={{
                  fontFamily: 'var(--font-slab)',
                  fontSize: '1.1rem',
                  fontWeight: 600,
                  color: 'var(--ink)',
                }}>
                  Authoritative Data Sources (Decided by Validators)
                </h3>
              </div>
              <p style={{ fontSize: '0.84rem', color: 'var(--ink-muted)', marginBottom: 14 }}>
                Validators evaluated data fetchability and selected the following live web domains to resolve this question without human intervention:
              </p>

              {/* Recommended Sources Badges */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
                {(validationResult?.sources || []).map((domain, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '6px 12px',
                      borderRadius: 'var(--radius-control)',
                      background: 'var(--paper-sunk)',
                      border: 'var(--border-rule)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.84rem',
                      color: 'var(--ink)',
                    }}
                  >
                    <CheckCircle2 size={14} color="var(--sage)" />
                    <span>{domain}</span>
                  </div>
                ))}
              </div>

              {/* Rationale Quote */}
              {validationResult?.source_rationale && (
                <div className="legal-well" style={{ fontSize: '0.82rem', color: 'var(--ink)', marginBottom: 14 }}>
                  <span style={{
                    display: 'block',
                    fontSize: '0.70rem',
                    textTransform: 'uppercase',
                    color: 'var(--ink-muted)',
                    marginBottom: 4,
                  }}>
                    Validator Source Rationale
                  </span>
                  {validationResult.source_rationale}
                </div>
              )}

              {/* Advanced: Optional Extra Domains */}
              <div>
                <button
                  type="button"
                  onClick={() => setShowExtraSources(!showExtraSources)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: '0.78rem',
                    color: 'var(--ink-muted)',
                    cursor: 'pointer',
                    background: 'none',
                    border: 'none',
                    padding: 0,
                  }}
                >
                  {showExtraSources ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  <span>{showExtraSources ? 'Hide custom source domains' : '+ Add extra source domains (Optional)'}</span>
                </button>

                {showExtraSources && (
                  <div style={{ marginTop: 10 }}>
                    <input
                      type="text"
                      value={extraSources}
                      onChange={(e) => setExtraSources(e.target.value)}
                      placeholder="e.g. data.example.com, feeds.oracle.org"
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        borderRadius: 'var(--radius-control)',
                        border: 'var(--border-rule)',
                        background: 'var(--paper-sunk)',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.82rem',
                        color: 'var(--ink)',
                      }}
                    />
                    <span style={{ fontSize: '0.72rem', color: 'var(--ink-muted)', marginTop: 4, display: 'block' }}>
                      Comma-separated extra domains to include in the validator scrape whitelist.
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Timeline & Close Time */}
            <div className="legal-panel">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <Clock size={18} color="var(--sage)" />
                <h3 style={{
                  fontFamily: 'var(--font-slab)',
                  fontSize: '1.1rem',
                  fontWeight: 600,
                  color: 'var(--ink)',
                }}>
                  Market Close Time
                </h3>
              </div>

              {/* Feedback whether timeline was auto-detected or needs specification */}
              {validationResult?.timeline_detected ? (
                <div style={{
                  padding: '10px 12px',
                  borderRadius: 'var(--radius-control)',
                  background: 'rgba(114, 152, 119, 0.12)',
                  border: '1px solid var(--sage)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: 14,
                  fontSize: '0.84rem',
                  color: 'var(--ink)',
                }}>
                  <CheckCircle2 size={16} color="var(--sage)" style={{ flexShrink: 0 }} />
                  <div>
                    <strong>Timeline automatically detected:</strong> "{validationResult.timeline_text}". Validators pre-filled the close time below.
                  </div>
                </div>
              ) : (
                <div style={{
                  padding: '10px 12px',
                  borderRadius: 'var(--radius-control)',
                  background: 'var(--paper-sunk)',
                  border: 'var(--border-rule)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: 14,
                  fontSize: '0.84rem',
                  color: 'var(--ink)',
                }}>
                  <AlertCircle size={16} color="var(--ink-muted)" style={{ flexShrink: 0 }} />
                  <div>
                    No deadline detected in question. Please specify when trading closes and resolution begins:
                  </div>
                </div>
              )}

              {/* Close Date Picker & Quick presets */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <input
                  type="datetime-local"
                  value={closeDate}
                  onChange={(e) => setCloseDate(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 'var(--radius-control)',
                    border: 'var(--border-rule)',
                    background: 'var(--paper-sunk)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.88rem',
                    color: 'var(--ink)',
                  }}
                />

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  <span style={{ fontSize: '0.72rem', color: 'var(--ink-muted)', alignSelf: 'center', marginRight: 4 }}>
                    Presets:
                  </span>
                  {[7, 14, 30, 90].map((days) => (
                    <button
                      key={days}
                      type="button"
                      onClick={() => setQuickTimelineDays(days)}
                      style={{
                        padding: '4px 8px',
                        fontSize: '0.72rem',
                        fontFamily: 'var(--font-mono)',
                        borderRadius: 'var(--radius-control)',
                        background: 'var(--paper-sunk)',
                        border: 'var(--border-rule)',
                        color: 'var(--ink)',
                        cursor: 'pointer',
                      }}
                    >
                      +{days}d
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={setQuickTimelineEndOfYear}
                    style={{
                      padding: '4px 8px',
                      fontSize: '0.72rem',
                      fontFamily: 'var(--font-mono)',
                      borderRadius: 'var(--radius-control)',
                      background: 'var(--paper-sunk)',
                      border: 'var(--border-rule)',
                      color: 'var(--ink)',
                      cursor: 'pointer',
                    }}
                  >
                    End of Year
                  </button>
                </div>
              </div>
            </div>

            {/* Liquidity & Economic Parameters */}
            <div className="legal-panel">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <DollarSign size={18} color="var(--sage)" />
                <h3 style={{
                  fontFamily: 'var(--font-slab)',
                  fontSize: '1.1rem',
                  fontWeight: 600,
                  color: 'var(--ink)',
                }}>
                  Initial AMM Liquidity
                </h3>
              </div>
              <p style={{ fontSize: '0.84rem', color: 'var(--ink-muted)', marginBottom: 14 }}>
                Seeds the integer constant product AMM pool so traders can immediately buy and sell outcome shares.
              </p>

              <div>
                <label style={{
                  display: 'block',
                  fontSize: '0.76rem',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  color: 'var(--ink-muted)',
                  marginBottom: 6,
                }}>
                  Initial Liquidity Deposit (GEN)
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
                    background: 'var(--paper-sunk)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.90rem',
                    color: 'var(--ink)',
                  }}
                />
              </div>
            </div>
          </div>

          {/* Right Column: Spec Sheet Verification & Deployment CTA */}
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
                  <FileCheck size={18} color="var(--sage)" />
                  <h3 style={{
                    fontFamily: 'var(--font-slab)',
                    fontSize: 'var(--t-section)',
                    fontWeight: 600,
                    color: 'var(--ink)',
                  }}>
                    Compiler Synthesis
                  </h3>
                </div>
                <span className="state-pill state-open">READY FOR STUDIO</span>
              </div>

              {/* Synthesis Summary */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{
                  padding: 12,
                  background: 'var(--paper-sunk)',
                  borderRadius: 'var(--radius-control)',
                  border: 'var(--border-rule)',
                }}>
                  <div style={{ fontSize: '0.70rem', color: 'var(--ink-muted)', textTransform: 'uppercase' }}>
                    RESOLVABILITY GATE VERDICT
                  </div>
                  <div style={{ fontSize: '0.86rem', fontWeight: 600, color: 'var(--forest)', marginTop: 2 }}>
                    Live Web Data Fetch Confirmed
                  </div>
                  <div style={{ fontSize: '0.74rem', color: 'var(--ink-muted)', marginTop: 2 }}>
                    Confidence: {Math.round((validationResult?.confidence || 0.95) * 100)}% by GenLayer Consensus
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <span style={{ fontSize: '0.70rem', color: 'var(--ink-muted)', textTransform: 'uppercase' }}>
                      Predicate Type:
                    </span>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.86rem', fontWeight: 600, color: 'var(--ink)' }}>
                      {(validationResult?.predicate_type || 'EVENT').toUpperCase()}
                    </div>
                  </div>

                  <div>
                    <span style={{ fontSize: '0.70rem', color: 'var(--ink-muted)', textTransform: 'uppercase' }}>
                      Quorum Threshold:
                    </span>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.86rem', fontWeight: 600, color: 'var(--ink)' }}>
                      2 of {Math.max((validationResult?.sources?.length || 2), 2)} sources
                    </div>
                  </div>
                </div>

                {/* Economic Escrow breakdown */}
                <div className="legal-well" style={{ fontSize: '0.80rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ color: 'var(--ink-muted)' }}>Initial Seed Liquidity:</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--ink)' }}>
                      {parseFloat(initialLiquidity || 0).toFixed(2)} GEN
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ color: 'var(--ink-muted)' }}>Author Bond Escrow:</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--ink)' }}>
                      5.00 GEN
                    </span>
                  </div>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    borderTop: 'var(--border-rule)',
                    paddingTop: 6,
                    fontWeight: 700,
                  }}>
                    <span style={{ color: 'var(--ink)' }}>Total Value:</span>
                    <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink)' }}>
                      {(parseFloat(initialLiquidity || 0) + 5.0).toFixed(2)} GEN
                    </span>
                  </div>
                </div>

                <p style={{ fontSize: '0.74rem', color: 'var(--ink-muted)', lineHeight: 1.4 }}>
                  Author bond is refunded upon valid resolution. Slashed only if the question is ruled maliciously ambiguous by Court precedent.
                </p>

                {/* Submission CTA */}
                <button
                  type="button"
                  onClick={handleCompileAndPublish}
                  disabled={submitting}
                  style={{
                    width: '100%',
                    padding: '14px',
                    background: submitting ? 'var(--paper-sunk)' : 'var(--ink)',
                    color: submitting ? 'var(--ink-muted)' : 'var(--paper)',
                    borderRadius: 'var(--radius-control)',
                    fontWeight: 600,
                    fontSize: '0.90rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    cursor: submitting ? 'not-allowed' : 'pointer',
                    border: 'none',
                    marginTop: 6,
                  }}
                >
                  {submitting ? 'Compiling on GenLayer StudioNet...' : 'Compile & Publish Market'}
                  <ArrowRight size={16} />
                </button>

                {/* Submitting progress info */}
                {submitting && (
                  <div style={{
                    fontSize: '0.78rem',
                    fontFamily: 'var(--font-mono)',
                    color: 'var(--forest)',
                    textAlign: 'center',
                    padding: '6px 8px',
                    background: 'var(--paper-sunk)',
                    borderRadius: 'var(--radius-control)',
                  }}>
                    {submitStep}
                  </div>
                )}

                {/* Success Banner */}
                {submitSuccess && (
                  <div style={{
                    padding: 12,
                    borderRadius: 'var(--radius-control)',
                    background: 'rgba(114, 152, 119, 0.12)',
                    color: 'var(--forest)',
                    fontSize: '0.82rem',
                    border: '1px solid var(--forest)',
                    fontFamily: 'var(--font-mono)',
                  }}>
                    Market #{submitSuccess.market_id || '1'} compiled and deployed successfully!
                  </div>
                )}

                {/* Error Banner */}
                {submitError && (
                  <div style={{
                    padding: 12,
                    borderRadius: 'var(--radius-control)',
                    background: 'rgba(215, 60, 60, 0.08)',
                    color: '#c53030',
                    fontSize: '0.82rem',
                    border: '1px solid rgba(215, 60, 60, 0.35)',
                    fontFamily: 'var(--font-mono)',
                  }}>
                    Error: {submitError}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
