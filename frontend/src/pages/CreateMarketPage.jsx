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
  Plus,
  X,
  AlertTriangle
} from 'lucide-react';
import { parseGenToWei, formatGen } from '../lib/contracts';

const EXAMPLE_QUESTIONS = [
  'Will Bitcoin exceed $120,000 before December 31, 2026?',
  'Will the Federal Reserve lower interest rates before December 31, 2026?',
  'Will Apple market cap surpass $4 Trillion USD by end of Q4 2026?',
  'Will GenLayer StudioNet reach 1,000 active smart contracts by December 31, 2026?'
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
  const [selectedSources, setSelectedSources] = useState([]);
  const [customDomainInput, setCustomDomainInput] = useState('');

  // Submission state
  const [submitting, setSubmitting] = useState(false);
  const [submitStep, setSubmitStep] = useState('');
  const [submitError, setSubmitError] = useState(null);
  const [submitSuccess, setSubmitSuccess] = useState(null);
  const [rejectionDetails, setRejectionDetails] = useState(null);

  // Stage 1: Consult validators on the question
  const handleConsultValidators = async (e, overrideQ = null) => {
    if (e && e.preventDefault) e.preventDefault();
    const cleanQ = (overrideQ !== null ? overrideQ : question).trim();
    if (!cleanQ) {
      setValidationError('Please enter a prediction market question in plain English.');
      return;
    }
    if (cleanQ.length < 12) {
      setValidationError('The question is too brief. Please provide a clear, specific market proposition.');
      return;
    }

    setValidating(true);
    setValidationError(null);
    setValidationResult(null);
    setRejectionDetails(null);

    try {
      const res = await fetch('/api/validate-market', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: cleanQ }),
      });

      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`Server response error (${res.status}): ${text.slice(0, 100)}`);
      }

      if (!res.ok) {
        throw new Error(data.error || 'Validator consultation failed. Please check network connection.');
      }

      setValidationResult(data);
      setSelectedSources(data.sources || []);

      if (data.resolvable) {
        // If question specified a timeline, auto-populate it
        if (data.timeline_detected && data.detected_close_iso) {
          setCloseDate(data.detected_close_iso);
        } else {
          // If no timeline detected, default to 14 days ahead so user can review or change
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

  const addCustomSource = () => {
    const domain = customDomainInput.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
    if (domain && !selectedSources.includes(domain)) {
      setSelectedSources([...selectedSources, domain]);
      setCustomDomainInput('');
    }
  };

  const removeSource = (domainToRemove) => {
    setSelectedSources(selectedSources.filter((d) => d !== domainToRemove));
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
    if (selectedSources.length < 3) {
      setSubmitError(`At least 3 independent source domains are required for on-chain consensus (currently ${selectedSources.length}). Please add more sources.`);
      return;
    }

    setSubmitting(true);
    setSubmitStep('Broadcasting compile_market to GenLayer StudioNet...');
    setSubmitError(null);
    setSubmitSuccess(null);
    setRejectionDetails(null);

    try {
      const closeTimestamp = Math.floor(new Date(closeDate).getTime() / 1000);
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (closeTimestamp <= nowSeconds) {
        throw new Error('Market close time must be in the future.');
      }

      const authorBond = parseGenToWei('5.0');
      const depositLiquidity = parseGenToWei(initialLiquidity || '1.0');
      const totalValueWei = (BigInt(authorBond) + BigInt(depositLiquidity)).toString();

      setSubmitStep('Broadcasting transaction to GenLayer StudioNet...');

      const res = await fetch('/api/relay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'compile_market',
          question: question.trim(),
          close_time: closeTimestamp,
          seed_liquidity_wei: depositLiquidity,
          extra_sources_csv: selectedSources.join(','),
          value_wei: totalValueWei,
          author: userAddress || '0xBC1399c55538eC034d4Da550C03c34Ae0C357f53',
        }),
      });

      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`Server response error (${res.status}): ${text.slice(0, 100)}`);
      }

      // Check if on-chain validators rejected the market proposition
      if (!res.ok || data.created === false || !data.success) {
        setSubmitStep('');
        setSubmitting(false);
        setRejectionDetails({
          problems: data.problems && data.problems.length > 0 ? data.problems : [data.error || 'Resolvability criteria not satisfied.'],
          suggested_rewrites: data.suggested_rewrites || [],
          refunded_wei: data.refunded_wei || '0',
          reason: data.reason || 'NOT_RESOLVABLE',
        });
        setSubmitError(data.error || 'On-chain GenLayer validators rejected this proposition.');
        return;
      }

      // If async pending broadcast, poll status until consensus is reached
      if (data.pending && data.tx_hash) {
        const txHash = data.tx_hash;
        setSubmitStep(`Broadcast confirmed (${txHash.slice(0, 10)}...). Awaiting validator consensus...`);

        let attempts = 0;
        const maxAttempts = 60; // up to 180 seconds
        const pollInterval = 3000;

        while (attempts < maxAttempts) {
          await new Promise((r) => setTimeout(r, pollInterval));
          attempts++;

          try {
            const statusRes = await fetch(`/api/relay/status/${txHash}`);
            const statusText = await statusRes.text();
            let statusData;
            try {
              statusData = JSON.parse(statusText);
            } catch {
              continue;
            }

            if (statusData.status === 'PENDING') {
              setSubmitStep(statusData.message || `Validators verifying specification (${attempts * 3}s elapsed)...`);
              continue;
            }

            if (statusData.status === 'REJECTED' || statusData.created === false) {
              setSubmitStep('');
              setSubmitting(false);
              setRejectionDetails({
                problems: statusData.problems && statusData.problems.length > 0 ? statusData.problems : [statusData.error || 'Resolvability criteria not satisfied.'],
                suggested_rewrites: statusData.suggested_rewrites || [],
                refunded_wei: statusData.refunded_wei || '0',
                reason: statusData.reason || 'NOT_RESOLVABLE',
              });
              setSubmitError(statusData.error || 'On-chain GenLayer validators rejected this proposition.');
              return;
            }

            if (statusData.status === 'SUCCESS' && statusData.created) {
              setRejectionDetails(null);
              setSubmitStep('Validator consensus reached: ACCEPTED');
              setSubmitSuccess(statusData);
              setSubmitting(false);

              if (onMarketCreated && statusData.market_id) {
                setTimeout(() => onMarketCreated(statusData.market_id), 2000);
              }
              return;
            }

            if (statusData.status === 'ERROR' || statusData.status === 'FAILED') {
              throw new Error(statusData.error || 'Transaction failed on-chain.');
            }
          } catch (pollErr) {
            console.warn('[PollStatus] Warning:', pollErr.message);
          }
        }

        // If client polling timed out
        setSubmitting(false);
        setSubmitStep('');
        setSubmitError(`Consensus is still processing on StudioNet for tx ${txHash.slice(0, 10)}... Please refresh or check the Markets Explorer in a moment.`);
        return;
      }

      setRejectionDetails(null);
      setSubmitStep('Validator consensus reached: ACCEPTED');
      setSubmitSuccess(data);

      // Only navigate to the market if a genuine new market was created
      if (onMarketCreated && data.market_id) {
        setTimeout(() => onMarketCreated(data.market_id), 2200);
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
                  placeholder="e.g. Will Bitcoin exceed $120,000 before December 31, 2026? or Will the Federal Reserve lower interest rates before December 31, 2026?"
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
                    
                    {validationResult.suggested_rewrite && (
                      <div style={{ marginTop: 10 }}>
                        <button
                          type="button"
                          onClick={() => {
                            setQuestion(validationResult.suggested_rewrite);
                            setValidationResult(null);
                            setValidationError(null);
                            handleConsultValidators(null, validationResult.suggested_rewrite);
                          }}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                            padding: '6px 10px',
                            borderRadius: 'var(--radius-control)',
                            background: 'var(--paper)',
                            border: '1px solid var(--forest)',
                            fontSize: '0.80rem',
                            color: 'var(--ink)',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          <span>Adopt suggested wording: "{validationResult.suggested_rewrite}"</span>
                          <ArrowRight size={14} color="var(--forest)" />
                        </button>
                      </div>
                    )}

                    <p style={{ fontSize: '0.78rem', color: 'var(--ink-muted)', marginTop: 8 }}>
                      <strong>Tip:</strong> Re-phrase your question around verifiable market numbers, official announcements, or empirical event records with a specific calendar date.
                    </p>
                  </div>
                </div>
              )}

              {/* Validator Optimization Suggestion */}
              {validationResult?.suggested_refinement && (
                <div style={{
                  padding: 16,
                  borderRadius: 'var(--radius-control)',
                  background: 'rgba(114, 152, 119, 0.12)',
                  border: '1px solid var(--sage)',
                  display: 'flex',
                  gap: 12,
                  alignItems: 'flex-start',
                }}>
                  <Sparkles size={20} color="var(--sage)" style={{ flexShrink: 0, marginTop: 2 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <h4 style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--ink)' }}>
                        Validator Optimization Suggestion
                      </h4>
                      <span style={{ fontSize: '0.72rem', color: 'var(--forest)', fontWeight: 600 }}>
                        RECOMMENDED
                      </span>
                    </div>
                    <p style={{ fontSize: '0.82rem', color: 'var(--ink-muted)', marginTop: 4, marginBottom: 10, lineHeight: 1.45 }}>
                      {validationResult.optimization_tip || 'Specifying the official primary observation point ensures guaranteed consensus across all validator nodes.'}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setQuestion(validationResult.suggested_refinement);
                        handleConsultValidators(null, validationResult.suggested_refinement);
                      }}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '8px 14px',
                        borderRadius: 'var(--radius-control)',
                        background: 'var(--forest)',
                        color: '#fff',
                        fontSize: '0.82rem',
                        fontWeight: 600,
                        border: 'none',
                        cursor: 'pointer',
                        boxShadow: 'var(--shadow-subtle)',
                      }}
                    >
                      <Sparkles size={14} />
                      <span>Use Optimized Formulation: "{validationResult.suggested_refinement.slice(0, 68)}..."</span>
                      <ArrowRight size={14} />
                    </button>
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
                  onClick={() => {
                    setStage(1);
                    setRejectionDetails(null);
                    setSubmitError(null);
                  }}
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

              {/* Selected Sources Badges with remove buttons */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                {selectedSources.map((domain, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '6px 10px',
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
                    <button
                      type="button"
                      onClick={() => removeSource(domain)}
                      title={`Remove ${domain}`}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--ink-muted)',
                        cursor: 'pointer',
                        padding: '0 2px',
                        display: 'flex',
                        alignItems: 'center',
                      }}
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>

              {/* Quorum Warning / Success Status */}
              {selectedSources.length < 3 ? (
                <div style={{
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-control)',
                  background: 'rgba(215, 60, 60, 0.08)',
                  border: '1px solid rgba(215, 60, 60, 0.35)',
                  color: '#c53030',
                  fontSize: '0.80rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: 12,
                }}>
                  <AlertTriangle size={15} style={{ flexShrink: 0 }} />
                  <span>
                    <strong>Quorum Warning:</strong> GenLayer Charter v1 requires a minimum of 3 independent source domains (currently {selectedSources.length} selected). Please add at least {3 - selectedSources.length} more source below.
                  </span>
                </div>
              ) : (
                <div style={{
                  padding: '6px 10px',
                  borderRadius: 'var(--radius-control)',
                  background: 'rgba(114, 152, 119, 0.10)',
                  border: '1px solid rgba(114, 152, 119, 0.3)',
                  color: 'var(--forest)',
                  fontSize: '0.78rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  marginBottom: 12,
                }}>
                  <CheckCircle2 size={14} color="var(--sage)" />
                  <span>Quorum threshold met ({selectedSources.length} independent domains configured).</span>
                </div>
              )}

              {/* Quick Add Domain Presets */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14, alignItems: 'center' }}>
                <span style={{ fontSize: '0.72rem', color: 'var(--ink-muted)' }}>Quick add:</span>
                {['metoffice.gov.uk', 'open-meteo.com', 'ecmwf.int', 'bbc.com', 'reuters.com', 'apnews.com', 'bloomberg.com', 'sec.gov', 'noaa.gov', 'api.coingecko.com']
                  .filter((d) => !selectedSources.includes(d))
                  .slice(0, 5)
                  .map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setSelectedSources([...selectedSources, preset])}
                      style={{
                        fontSize: '0.72rem',
                        padding: '3px 8px',
                        borderRadius: 'var(--radius-control)',
                        background: 'var(--paper)',
                        border: 'var(--border-rule)',
                        color: 'var(--sage)',
                        cursor: 'pointer',
                        fontWeight: 600,
                      }}
                    >
                      + {preset}
                    </button>
                  ))}
              </div>

              {/* Custom Domain Input */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                <input
                  type="text"
                  value={customDomainInput}
                  onChange={(e) => setCustomDomainInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addCustomSource();
                    }
                  }}
                  placeholder="Add custom domain (e.g. data.gov.uk)"
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-control)',
                    border: 'var(--border-rule)',
                    background: 'var(--paper-sunk)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.82rem',
                    color: 'var(--ink)',
                  }}
                />
                <button
                  type="button"
                  onClick={addCustomSource}
                  style={{
                    padding: '8px 14px',
                    borderRadius: 'var(--radius-control)',
                    background: 'var(--paper-sunk)',
                    border: 'var(--border-rule)',
                    color: 'var(--ink)',
                    fontSize: '0.80rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <Plus size={14} />
                  Add
                </button>
              </div>

              {/* Rationale Quote */}
              {validationResult?.source_rationale && (
                <div className="legal-well" style={{ fontSize: '0.82rem', color: 'var(--ink)' }}>
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
                      2 of {Math.max(selectedSources.length, 3)} sources
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
                  disabled={submitting || selectedSources.length < 3}
                  style={{
                    width: '100%',
                    padding: '14px',
                    background: (submitting || selectedSources.length < 3) ? 'var(--paper-sunk)' : 'var(--ink)',
                    color: (submitting || selectedSources.length < 3) ? 'var(--ink-muted)' : 'var(--paper)',
                    borderRadius: 'var(--radius-control)',
                    fontWeight: 600,
                    fontSize: '0.90rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    cursor: (submitting || selectedSources.length < 3) ? 'not-allowed' : 'pointer',
                    border: 'none',
                    marginTop: 6,
                  }}
                >
                  {submitting
                    ? 'Compiling on GenLayer StudioNet...'
                    : selectedSources.length < 3
                    ? `Select at least 3 sources (${selectedSources.length}/3)`
                    : 'Compile & Publish Market'}
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
                    Market #{submitSuccess.market_id} compiled and deployed successfully! Redirecting...
                  </div>
                )}

                {/* On-Chain Rejection Details Card */}
                {rejectionDetails && (
                  <div style={{
                    padding: 16,
                    borderRadius: 'var(--radius-control)',
                    background: 'rgba(215, 60, 60, 0.08)',
                    border: '1px solid rgba(215, 60, 60, 0.4)',
                    marginTop: 10,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <ShieldAlert size={18} color="#c53030" style={{ flexShrink: 0 }} />
                      <h4 style={{ fontSize: '0.86rem', fontWeight: 700, color: 'var(--ink)' }}>
                        On-Chain Resolvability Gate Rejected
                      </h4>
                    </div>
                    <p style={{ fontSize: '0.80rem', color: 'var(--ink-muted)', marginBottom: 10, lineHeight: 1.45 }}>
                      GenLayer AI validator consensus executed your proposition and determined it cannot be settled deterministically from empirical evidence.
                    </p>

                    {rejectionDetails.problems?.length > 0 && (
                      <div style={{ marginBottom: 12 }}>
                        <span style={{ fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--ink-muted)', fontWeight: 600 }}>
                          Validator Gate Failures:
                        </span>
                        <ul style={{ paddingLeft: 18, marginTop: 4, fontSize: '0.80rem', color: 'var(--ink)', lineHeight: 1.45 }}>
                          {rejectionDetails.problems.map((prob, idx) => (
                            <li key={idx} style={{ marginBottom: 4 }}>{prob}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {rejectionDetails.refunded_wei && rejectionDetails.refunded_wei !== '0' && (
                      <div style={{
                        fontSize: '0.74rem',
                        fontFamily: 'var(--font-mono)',
                        color: 'var(--forest)',
                        marginBottom: 12,
                        padding: '6px 10px',
                        background: 'var(--paper-sunk)',
                        borderRadius: 'var(--radius-control)',
                        border: 'var(--border-rule)',
                      }}>
                        ✓ Refunded {formatGen(rejectionDetails.refunded_wei)} GEN to author address.
                      </div>
                    )}

                    {rejectionDetails.suggested_rewrites?.length > 0 && (
                      <div style={{ marginTop: 8 }}>
                        <span style={{ fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--ink-muted)', fontWeight: 600 }}>
                          Validator Suggested Rewrites (Click to adopt):
                        </span>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                          {rejectionDetails.suggested_rewrites.map((rw, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => {
                                setQuestion(rw);
                                setStage(1);
                                setRejectionDetails(null);
                                setSubmitError(null);
                                handleConsultValidators(null, rw);
                              }}
                              style={{
                                textAlign: 'left',
                                padding: '8px 10px',
                                background: 'var(--paper)',
                                border: '1px solid var(--sage)',
                                borderRadius: 'var(--radius-control)',
                                fontSize: '0.78rem',
                                color: 'var(--ink)',
                                cursor: 'pointer',
                                lineHeight: 1.35,
                              }}
                            >
                              <div>{rw}</div>
                              <span style={{ fontSize: '0.70rem', color: 'var(--sage)', fontWeight: 600, display: 'inline-block', marginTop: 2 }}>
                                Use this rewrite & re-consult validators →
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        setStage(1);
                        setRejectionDetails(null);
                        setSubmitError(null);
                      }}
                      style={{
                        marginTop: 12,
                        padding: '6px 12px',
                        fontSize: '0.78rem',
                        background: 'var(--ink)',
                        color: 'var(--paper)',
                        borderRadius: 'var(--radius-control)',
                        cursor: 'pointer',
                        fontWeight: 600,
                        border: 'none',
                      }}
                    >
                      ← Edit Question in Step 1
                    </button>
                  </div>
                )}

                {/* Generic Error Banner */}
                {submitError && !rejectionDetails && (
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
