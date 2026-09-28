import React, { useState, useEffect } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { chains, createClient } from 'genlayer-js';
import {
  ArrowLeft,
  Lock,
  Globe,
  Hash,
  Shield,
  Clock,
  TrendingUp,
  Droplet,
  AlertTriangle,
  CheckCircle,
  RefreshCw,
  ExternalLink,
  ChevronRight,
  Award,
  Scale
} from 'lucide-react';
import { CONTRACTS, formatGen, parseGenToWei, formatDateTime, bpsToPercent } from '../lib/contracts';

export default function MarketDetailPage({ marketId, onBack }) {
  const { user, authenticated } = usePrivy();
  const { wallets } = useWallets();
  const userAddress = user?.wallet?.address;

  const [market, setMarket] = useState(null);
  const [position, setPosition] = useState(null);
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Tabs: 'trade', 'liquidity', 'contest', 'lifecycle'
  const [activeTab, setActiveTab] = useState('trade');

  // Trade form
  const [tradeType, setTradeType] = useState('buy'); // 'buy' | 'sell'
  const [selectedOutcome, setSelectedOutcome] = useState(0);
  const [tradeAmount, setTradeAmount] = useState('0.1'); // collateral in buy, shares in sell
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState(null);

  // Liquidity form
  const [lpAction, setLpAction] = useState('add'); // 'add' | 'remove'
  const [lpAmount, setLpAmount] = useState('0.5');

  // Contest form
  const [evidenceUrl, setEvidenceUrl] = useState('');

  const fetchMarketData = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/markets/${marketId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setMarket(data);

      // Fetch trades
      try {
        const tradeRes = await fetch(`/api/markets/${marketId}/trades`);
        if (tradeRes.ok) {
          const tradeData = await tradeRes.json();
          setTrades(tradeData.trades || []);
        }
      } catch (e) {
        console.warn('Could not load trades:', e);
      }

      // Fetch position for connected wallet or demo address
      const targetAddress = userAddress || '0xBC1399c55538eC034d4Da550C03c34Ae0C357f53';
      try {
        const posRes = await fetch(`/api/markets/${marketId}/position/${targetAddress}`);
        if (posRes.ok) {
          const posData = await posRes.json();
          setPosition(posData);
        }
      } catch (e) {
        console.warn('Could not load position:', e);
      }
    } catch (err) {
      console.error('Failed to load market:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMarketData();
  }, [marketId, userAddress]);

  if (loading && !market) {
    return (
      <div style={{ maxWidth: 1280, margin: '40px auto', padding: '0 24px', textAlign: 'center', fontFamily: 'var(--font-mono)' }}>
        Loading market #{marketId}...
      </div>
    );
  }

  if (error || !market) {
    return (
      <div style={{ maxWidth: 1280, margin: '40px auto', padding: '0 24px' }}>
        <button onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16, color: 'var(--ink-muted)' }}>
          <ArrowLeft size={16} /> Back to Markets
        </button>
        <div className="legal-panel" style={{ textAlign: 'center', padding: 32 }}>
          <h3>Unable to load market #{marketId}</h3>
          <p style={{ color: 'var(--ink-muted)', marginTop: 8 }}>{error || 'Market not found'}</p>
        </div>
      </div>
    );
  }

  const outcomes = Array.isArray(market.outcomes) ? market.outcomes : [];
  const sources = Array.isArray(market.sources) ? market.sources : [];
  const tags = Array.isArray(market.tags) ? market.tags : [];
  const prices = Array.isArray(market.prices_bps) ? market.prices_bps : [];
  const userShares = position?.shares || {};

  // Action dispatcher
  const executeContractCall = async (method, args = [], valueWei = '0') => {
    setActionLoading(true);
    setActionMessage({ type: 'info', text: `Broadcasting ${method} to GenLayer StudioNet...` });
    try {
      let executedOnChain = false;
      let txHash = null;

      // 1. Direct wallet execution if connected with Privy wallet provider
      const primaryWallet = wallets?.[0];
      if (primaryWallet && userAddress && primaryWallet.address?.toLowerCase() === userAddress.toLowerCase()) {
        try {
          const provider = await primaryWallet.getEthereumProvider();
          if (provider) {
            setActionMessage({ type: 'info', text: `Signing ${method} with wallet on GenLayer StudioNet...` });
            const userClient = createClient({
              chain: chains.studionet,
              endpoint: 'https://studio.genlayer.com/api',
              provider,
              account: primaryWallet.address,
            });

            const resolvedArgs = (args || []).map((arg, idx) => {
              if (['buy', 'sell'].includes(method) && idx === 1) return Number(arg);
              return String(arg);
            });

            txHash = await userClient.writeContract({
              address: CONTRACTS.market,
              functionName: method,
              args: resolvedArgs,
              value: BigInt(valueWei || '0'),
            });

            setActionMessage({ type: 'info', text: `Tx ${txHash.slice(0, 10)}... broadcast. Awaiting validator consensus...` });
            await userClient.waitForTransactionReceipt({
              hash: txHash,
              status: 'ACCEPTED',
              interval: 2000,
              retries: 45,
            });
            executedOnChain = true;
          }
        } catch (directErr) {
          console.warn('[Direct Wallet] Direct wallet execution fallback to gasless relayer:', directErr.message);
        }
      }

      // 2. Gasless transaction relayer execution
      if (!executedOnChain) {
        setActionMessage({ type: 'info', text: `Broadcasting gasless ${method} via Vantage Relayer to StudioNet...` });
        const payload = {
          market_id: marketId,
          method,
          args,
          value_wei: valueWei,
          caller: userAddress || '0xBC1399c55538eC034d4Da550C03c34Ae0C357f53',
        };

        const res = await fetch('/api/relay', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || `Transaction failed with status ${res.status}`);
        }
        txHash = data.tx_hash;
      }

      setActionMessage({
        type: 'success',
        text: `Action "${method}" confirmed on GenLayer StudioNet! ${txHash ? `Tx: ${txHash.slice(0, 10)}...` : 'Consensus: ACCEPTED'}`
      });

      // Refresh market state and user position
      await fetchMarketData();
    } catch (err) {
      console.error(`Call ${method} failed:`, err);
      setActionMessage({ type: 'error', text: err.message || 'Execution error.' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleBuy = () => {
    const valueWei = parseGenToWei(tradeAmount);
    executeContractCall('buy', [marketId, selectedOutcome, '0'], valueWei);
  };

  const handleSell = () => {
    const sharesWei = parseGenToWei(tradeAmount);
    executeContractCall('sell', [marketId, selectedOutcome, sharesWei, '0'], '0');
  };

  const handleAddLiquidity = () => {
    const valueWei = parseGenToWei(lpAmount);
    executeContractCall('add_liquidity', [marketId], valueWei);
  };

  const handleRemoveLiquidity = () => {
    const sharesWei = parseGenToWei(lpAmount);
    executeContractCall('remove_liquidity', [marketId, sharesWei], '0');
  };

  const handleChallenge = () => {
    if (!evidenceUrl) {
      alert('Please provide an evidence URL');
      return;
    }
    const bondWei = parseGenToWei('10.0'); // 10 GEN challenge bond
    executeContractCall('challenge', [marketId, evidenceUrl], bondWei);
  };

  const handleAppeal = () => {
    const bondWei = parseGenToWei('25.0'); // 25 GEN appeal bond
    executeContractCall('appeal', [marketId], bondWei);
  };

  const handleResolve = () => executeContractCall('resolve', [marketId]);
  const handleResolveChallenge = () => executeContractCall('resolve_challenge', [marketId]);
  const handleResolveAppeal = () => executeContractCall('resolve_appeal', [marketId]);
  const handleFinalize = () => executeContractCall('finalize', [marketId]);
  const handleSettle = () => executeContractCall('settle', [marketId]);
  const handleCloseMarket = () => executeContractCall('close_market', [marketId]);
  const handleVoidExpired = () => executeContractCall('void_expired', [marketId]);

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 24px' }}>
      {/* Top Breadcrumb */}
      <button
        onClick={onBack}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          color: 'var(--ink-muted)',
          fontSize: 'var(--t-control)',
          fontWeight: 600,
          marginBottom: 20,
        }}
      >
        <ArrowLeft size={16} /> All Prediction Markets
      </button>

      {/* Main Title & Status Row */}
      <div style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 16,
        marginBottom: 28,
        borderBottom: 'var(--border-rule)',
        paddingBottom: 20,
      }}>
        <div style={{ flex: '1 1 600px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-machine)', color: 'var(--ink-muted)' }}>
              MARKET #{market.market_id}
            </span>
            <span className={`state-pill state-${(market.state || 'OPEN').toLowerCase()}`}>
              {market.state || 'OPEN'}
            </span>
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.72rem',
              color: 'var(--ink-muted)',
              textTransform: 'uppercase',
            }}>
              [{market.predicate_type || 'event'}]
            </span>
          </div>

          <h1 style={{
            fontFamily: 'var(--font-slab)',
            fontSize: 'var(--t-display)',
            fontWeight: 700,
            lineHeight: 1.15,
            color: 'var(--ink)',
            marginBottom: 10,
          }}>
            {market.question}
          </h1>

          {market.restated_question && market.restated_question !== market.question && (
            <p style={{ fontStyle: 'italic', color: 'var(--ink-muted)', fontSize: '0.92rem' }}>
              Restated: "{market.restated_question}"
            </p>
          )}

          <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
            {tags.map((t, i) => (
              <span
                key={i}
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.70rem',
                  padding: '2px 8px',
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

        <button
          onClick={fetchMarketData}
          title="Refresh market state"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 12px',
            borderRadius: 'var(--radius-control)',
            border: 'var(--border-rule)',
            background: 'var(--paper-raised)',
            color: 'var(--ink-muted)',
            fontSize: 'var(--t-control)',
          }}
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* Asymmetric 62% / 38% Grid */}
      <div className="asymmetric-grid">
        {/* Left Column (62%): Spec Sheet, Quorum & Sources, User Position, Activity */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* Probability & Pricing Cards */}
          <div className="legal-panel">
            <h3 style={{
              fontSize: '0.82rem',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              color: 'var(--ink-muted)',
              marginBottom: 14,
            }}>
              Current Market Prices & Backing
            </h3>

            <div style={{
              display: 'grid',
              gridTemplateColumns: `repeat(auto-fit, minmax(130px, 1fr))`,
              gap: 12,
              marginBottom: 20,
            }}>
              {outcomes.map((label, idx) => {
                const bps = prices[idx] || (outcomes.length ? Math.round(10000 / outcomes.length) : 5000);
                const pct = (bps / 100).toFixed(1);
                const isSelected = selectedOutcome === idx;
                const isWinner = market.winning_outcome === idx;

                return (
                  <div
                    key={idx}
                    onClick={() => setSelectedOutcome(idx)}
                    style={{
                      padding: '14px',
                      borderRadius: 'var(--radius-control)',
                      background: isWinner
                        ? 'var(--forest)'
                        : isSelected
                        ? 'var(--paper-sunk)'
                        : 'var(--paper)',
                      color: isWinner ? 'var(--paper)' : 'var(--ink)',
                      border: isSelected
                        ? '2px solid var(--ink)'
                        : isWinner
                        ? '1px solid var(--forest)'
                        : 'var(--border-rule)',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      minHeight: 85,
                    }}
                  >
                    <div style={{ fontSize: '0.84rem', fontWeight: 600 }}>
                      {label}
                      {isWinner && (
                        <span style={{ marginLeft: 6, fontSize: '0.72rem', textTransform: 'uppercase' }}>
                          (Winner)
                        </span>
                      )}
                    </div>
                    <div style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '1.4rem',
                      fontWeight: 700,
                      marginTop: 6,
                    }}>
                      {pct}%
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Pool Statistics Bar */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 12,
              borderTop: 'var(--border-rule)',
              paddingTop: 16,
              fontFamily: 'var(--font-mono)',
            }}>
              <div>
                <div style={{ fontSize: '0.70rem', color: 'var(--ink-muted)' }}>COLLATERAL POOL</div>
                <div style={{ fontSize: '1rem', fontWeight: 600, marginTop: 2 }}>
                  {formatGen(market.collateral_wei)} GEN
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.70rem', color: 'var(--ink-muted)' }}>VOLUME TO DATE</div>
                <div style={{ fontSize: '1rem', fontWeight: 600, marginTop: 2 }}>
                  {formatGen(market.volume_wei)} GEN
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.70rem', color: 'var(--ink-muted)' }}>CREATOR EARNED</div>
                <div style={{ fontSize: '1rem', fontWeight: 600, marginTop: 2 }}>
                  {formatGen(market.creator_fees_wei)} GEN
                </div>
              </div>
            </div>
          </div>

          {/* Compiled Machine Spec */}
          <div className="legal-panel">
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 16,
              borderBottom: 'var(--border-rule)',
              paddingBottom: 10,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Lock size={15} color="var(--sage)" />
                <h3 style={{
                  fontFamily: 'var(--font-slab)',
                  fontSize: 'var(--t-section)',
                  fontWeight: 600,
                  color: 'var(--ink)',
                }}>
                  The Compiled Spec
                </h3>
              </div>
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.72rem',
                color: 'var(--ink-muted)',
              }}>
                Charter {market.charter_version || 'v1'}
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <span style={{ fontSize: '0.72rem', color: 'var(--ink-muted)', textTransform: 'uppercase' }}>
                  Execution Predicate:
                </span>
                <p style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.84rem',
                  background: 'var(--paper-sunk)',
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-control)',
                  border: 'var(--border-rule)',
                  marginTop: 4,
                  wordBreak: 'break-word',
                }}>
                  {market.predicate || 'Event outcome extraction via multi-source quorum'}
                </p>
              </div>

              {market.threshold && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <span style={{ fontSize: '0.72rem', color: 'var(--ink-muted)', textTransform: 'uppercase' }}>
                      Comparator:
                    </span>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.84rem', marginTop: 2 }}>
                      {market.comparator || 'gte'}
                    </div>
                  </div>
                  <div>
                    <span style={{ fontSize: '0.72rem', color: 'var(--ink-muted)', textTransform: 'uppercase' }}>
                      Threshold / Units:
                    </span>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.84rem', marginTop: 2 }}>
                      {market.threshold} {market.units}
                    </div>
                  </div>
                </div>
              )}

              <div>
                <span style={{ fontSize: '0.72rem', color: 'var(--ink-muted)', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Globe size={13} />
                  Authorized Information Sources ({sources.length}):
                </span>
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  marginTop: 6,
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.76rem',
                }}>
                  {sources.map((s, i) => (
                    <div
                      key={i}
                      style={{
                        padding: '6px 10px',
                        background: 'var(--paper-sunk)',
                        borderRadius: 'var(--radius-control)',
                        border: 'var(--border-rule)',
                        color: 'var(--ink-muted)',
                      }}
                    >
                      {s}
                    </div>
                  ))}
                </div>
              </div>

              {/* Spec Hash and Deadlines */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 12,
                borderTop: 'var(--border-rule)',
                paddingTop: 12,
                fontSize: '0.76rem',
                fontFamily: 'var(--font-mono)',
              }}>
                <div>
                  <span style={{ color: 'var(--ink-muted)' }}>CLOSE TIME</span>
                  <div style={{ marginTop: 2 }}>{formatDateTime(market.close_time)}</div>
                </div>
                <div>
                  <span style={{ color: 'var(--ink-muted)' }}>SPEC DIGEST</span>
                  <div style={{ marginTop: 2, wordBreak: 'break-all' }}>
                    {market.spec_hash ? `${market.spec_hash.slice(0, 16)}...` : 'LOCKED'}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* User Position Card */}
          {(authenticated || position) && (
            <div className="legal-panel">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                <h3 style={{
                  fontFamily: 'var(--font-slab)',
                  fontSize: 'var(--t-section)',
                  fontWeight: 600,
                  margin: 0,
                }}>
                  Your Position in this Market
                </h3>
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.72rem',
                  color: 'var(--ink-muted)',
                  background: 'var(--paper-sunk)',
                  padding: '4px 8px',
                  borderRadius: 'var(--radius-control)',
                  border: 'var(--border-rule)',
                }}>
                  {authenticated ? `ACCOUNT: ${userAddress?.slice(0, 6)}...${userAddress?.slice(-4)}` : `GASLESS / DEMO: 0xBC13...7f53`}
                </span>
              </div>

              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                gap: 12,
                fontFamily: 'var(--font-mono)',
              }}>
                {outcomes.map((label, idx) => {
                  const held = userShares[idx] || userShares[String(idx)] || '0';
                  return (
                    <div
                      key={idx}
                      style={{
                        background: 'var(--paper-sunk)',
                        padding: '12px',
                        borderRadius: 'var(--radius-control)',
                        border: 'var(--border-rule)',
                      }}
                    >
                      <div style={{ fontSize: '0.72rem', color: 'var(--ink-muted)' }}>{label}</div>
                      <div style={{ fontSize: '1.05rem', fontWeight: 600, marginTop: 4 }}>
                        {formatGen(held)} shares
                      </div>
                    </div>
                  );
                })}

                <div style={{
                  background: 'var(--paper-sunk)',
                  padding: '12px',
                  borderRadius: 'var(--radius-control)',
                  border: 'var(--border-rule)',
                }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--ink-muted)' }}>LP SHARES</div>
                  <div style={{ fontSize: '1.05rem', fontWeight: 600, marginTop: 4 }}>
                    {formatGen(position?.lp_shares || '0')}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Trade Activity */}
          <div className="legal-panel">
            <h3 style={{
              fontSize: '0.82rem',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              color: 'var(--ink-muted)',
              marginBottom: 12,
            }}>
              Recent Market Activity
            </h3>
            {trades.length === 0 ? (
              <p style={{ color: 'var(--ink-muted)', fontSize: '0.84rem', fontStyle: 'italic' }}>
                No trades indexed for this market yet.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>
                {trades.map((t, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 12px',
                      background: 'var(--paper-sunk)',
                      borderRadius: 'var(--radius-control)',
                      border: 'var(--border-rule)',
                    }}
                  >
                    <div>
                      <span style={{ fontWeight: 600, textTransform: 'uppercase', color: t.kind === 'BUY' ? 'var(--forest)' : 'var(--ink)' }}>
                        {t.kind}
                      </span>
                      <span style={{ marginLeft: 8, color: 'var(--ink-muted)' }}>
                        {outcomes[t.outcome_index] || `Outcome ${t.outcome_index}`}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 12 }}>
                      <span>{formatGen(t.collateral_amount_wei)} GEN</span>
                      <span style={{ color: 'var(--ink-muted)' }}>{t.trader ? `${t.trader.slice(0, 6)}...` : ''}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Column (38%): Action Desk (Trade, Liquidity, Contest, Lifecycle) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div className="legal-panel" style={{ position: 'sticky', top: 90 }}>
            {/* Action Tabs Header */}
            <div style={{
              display: 'flex',
              borderBottom: 'var(--border-rule)',
              marginBottom: 20,
              gap: 4,
            }}>
              <button
                onClick={() => setActiveTab('trade')}
                style={{
                  padding: '8px 14px',
                  fontSize: 'var(--t-control)',
                  fontWeight: 600,
                  color: activeTab === 'trade' ? 'var(--ink)' : 'var(--ink-muted)',
                  borderBottom: activeTab === 'trade' ? '2px solid var(--ink)' : '2px solid transparent',
                }}
              >
                Trade
              </button>
              <button
                onClick={() => setActiveTab('liquidity')}
                style={{
                  padding: '8px 14px',
                  fontSize: 'var(--t-control)',
                  fontWeight: 600,
                  color: activeTab === 'liquidity' ? 'var(--ink)' : 'var(--ink-muted)',
                  borderBottom: activeTab === 'liquidity' ? '2px solid var(--ink)' : '2px solid transparent',
                }}
              >
                Liquidity
              </button>
              <button
                onClick={() => setActiveTab('contest')}
                style={{
                  padding: '8px 14px',
                  fontSize: 'var(--t-control)',
                  fontWeight: 600,
                  color: activeTab === 'contest' ? 'var(--ink)' : 'var(--ink-muted)',
                  borderBottom: activeTab === 'contest' ? '2px solid var(--ink)' : '2px solid transparent',
                }}
              >
                Contest & Appeal
              </button>
              <button
                onClick={() => setActiveTab('lifecycle')}
                style={{
                  padding: '8px 14px',
                  fontSize: 'var(--t-control)',
                  fontWeight: 600,
                  color: activeTab === 'lifecycle' ? 'var(--ink)' : 'var(--ink-muted)',
                  borderBottom: activeTab === 'lifecycle' ? '2px solid var(--ink)' : '2px solid transparent',
                }}
              >
                Oracle
              </button>
            </div>

            {/* TAB 1: TRADE */}
            {activeTab === 'trade' && (
              <div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                  <button
                    onClick={() => setTradeType('buy')}
                    style={{
                      flex: 1,
                      padding: '8px',
                      borderRadius: 'var(--radius-control)',
                      background: tradeType === 'buy' ? 'var(--ink)' : 'var(--paper-sunk)',
                      color: tradeType === 'buy' ? 'var(--paper)' : 'var(--ink-muted)',
                      fontWeight: 600,
                      fontSize: 'var(--t-control)',
                    }}
                  >
                    Buy Outcome
                  </button>
                  <button
                    onClick={() => setTradeType('sell')}
                    style={{
                      flex: 1,
                      padding: '8px',
                      borderRadius: 'var(--radius-control)',
                      background: tradeType === 'sell' ? 'var(--ink)' : 'var(--paper-sunk)',
                      color: tradeType === 'sell' ? 'var(--paper)' : 'var(--ink-muted)',
                      fontWeight: 600,
                      fontSize: 'var(--t-control)',
                    }}
                  >
                    Sell Outcome
                  </button>
                </div>

                {/* Outcome Selector */}
                <div style={{ marginBottom: 14 }}>
                  <label style={{ fontSize: '0.74rem', color: 'var(--ink-muted)', textTransform: 'uppercase' }}>
                    Select Outcome:
                  </label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                    {outcomes.map((label, idx) => (
                      <button
                        key={idx}
                        onClick={() => setSelectedOutcome(idx)}
                        style={{
                          padding: '10px 14px',
                          borderRadius: 'var(--radius-control)',
                          background: selectedOutcome === idx ? 'var(--paper-sunk)' : 'transparent',
                          border: selectedOutcome === idx ? '1px solid var(--ink)' : '1px solid var(--hairline)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          textAlign: 'left',
                        }}
                      >
                        <span style={{ fontWeight: 600, fontSize: '0.86rem' }}>{label}</span>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.84rem' }}>
                          {bpsToPercent(prices[idx])}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Amount Input */}
                <div style={{ marginBottom: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <label style={{ fontSize: '0.74rem', color: 'var(--ink-muted)', textTransform: 'uppercase' }}>
                      {tradeType === 'buy' ? 'Collateral to Deposit (GEN)' : 'Shares to Sell'}
                    </label>
                  </div>
                  <input
                    type="number"
                    step="0.01"
                    min="0.001"
                    value={tradeAmount}
                    onChange={(e) => setTradeAmount(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      background: 'var(--paper-sunk)',
                      border: 'var(--border-rule)',
                      borderRadius: 'var(--radius-control)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '1rem',
                      color: 'var(--ink)',
                    }}
                  />
                </div>

                {/* Trading Fee Explainer */}
                <div style={{
                  background: 'var(--paper-sunk)',
                  padding: '10px 12px',
                  borderRadius: 'var(--radius-control)',
                  fontSize: '0.72rem',
                  color: 'var(--ink-muted)',
                  marginBottom: 16,
                  fontFamily: 'var(--font-mono)',
                }}>
                  <div>Total Fee: 2.0% (LP 1.2%, Creator 0.5%, Court 0.3%)</div>
                  <div style={{ marginTop: 2 }}>AMM Rule: Integer Constant Product with Ceil div</div>
                </div>

                {/* Submit Trade Button */}
                <button
                  onClick={tradeType === 'buy' ? handleBuy : handleSell}
                  disabled={actionLoading || market.state !== 'OPEN'}
                  style={{
                    width: '100%',
                    padding: '12px',
                    borderRadius: 'var(--radius-control)',
                    background: market.state !== 'OPEN' ? 'var(--paper-sunk)' : 'var(--ink)',
                    color: market.state !== 'OPEN' ? 'var(--ink-muted)' : 'var(--paper)',
                    fontWeight: 600,
                    fontSize: 'var(--t-control)',
                    cursor: market.state !== 'OPEN' ? 'not-allowed' : 'pointer',
                  }}
                >
                  {actionLoading
                    ? 'Processing on StudioNet...'
                    : market.state !== 'OPEN'
                    ? `Market is ${market.state}`
                    : tradeType === 'buy'
                    ? `Buy ${outcomes[selectedOutcome] || 'Outcome'} Shares`
                    : `Sell ${outcomes[selectedOutcome] || 'Outcome'} Shares`}
                </button>
              </div>
            )}

            {/* TAB 2: LIQUIDITY */}
            {activeTab === 'liquidity' && (
              <div>
                <p style={{ fontSize: '0.84rem', color: 'var(--ink-muted)', marginBottom: 14 }}>
                  Provide collateral across all outcome reserves. Earn 120 bps (1.2%) fee on every trade.
                </p>

                <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                  <button
                    onClick={() => setLpAction('add')}
                    style={{
                      flex: 1,
                      padding: '8px',
                      borderRadius: 'var(--radius-control)',
                      background: lpAction === 'add' ? 'var(--ink)' : 'var(--paper-sunk)',
                      color: lpAction === 'add' ? 'var(--paper)' : 'var(--ink-muted)',
                      fontWeight: 600,
                      fontSize: 'var(--t-control)',
                    }}
                  >
                    Add Liquidity
                  </button>
                  <button
                    onClick={() => setLpAction('remove')}
                    style={{
                      flex: 1,
                      padding: '8px',
                      borderRadius: 'var(--radius-control)',
                      background: lpAction === 'remove' ? 'var(--ink)' : 'var(--paper-sunk)',
                      color: lpAction === 'remove' ? 'var(--paper)' : 'var(--ink-muted)',
                      fontWeight: 600,
                      fontSize: 'var(--t-control)',
                    }}
                  >
                    Remove Liquidity
                  </button>
                </div>

                <div style={{ marginBottom: 16 }}>
                  <label style={{ fontSize: '0.74rem', color: 'var(--ink-muted)', textTransform: 'uppercase' }}>
                    {lpAction === 'add' ? 'Collateral to Deposit (GEN)' : 'LP Shares to Burn'}
                  </label>
                  <input
                    type="number"
                    step="0.05"
                    min="0.01"
                    value={lpAmount}
                    onChange={(e) => setLpAmount(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      background: 'var(--paper-sunk)',
                      border: 'var(--border-rule)',
                      borderRadius: 'var(--radius-control)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '1rem',
                      color: 'var(--ink)',
                      marginTop: 4,
                    }}
                  />
                </div>

                <button
                  onClick={lpAction === 'add' ? handleAddLiquidity : handleRemoveLiquidity}
                  disabled={actionLoading || (market.state !== 'OPEN' && market.state !== 'CLOSED')}
                  style={{
                    width: '100%',
                    padding: '12px',
                    borderRadius: 'var(--radius-control)',
                    background: 'var(--ink)',
                    color: 'var(--paper)',
                    fontWeight: 600,
                    fontSize: 'var(--t-control)',
                  }}
                >
                  {actionLoading
                    ? 'Processing...'
                    : lpAction === 'add'
                    ? 'Deposit Collateral & Mint LP Shares'
                    : 'Burn LP Shares & Reclaim Collateral'}
                </button>
              </div>
            )}

            {/* TAB 3: CONTEST & APPEAL */}
            {activeTab === 'contest' && (
              <div>
                <p style={{ fontSize: '0.84rem', color: 'var(--ink-muted)', marginBottom: 14 }}>
                  Dispute a provisional resolution before final settlement. Challenges require bond and contrary evidence.
                </p>

                {market.state === 'PROVISIONAL' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div>
                      <label style={{ fontSize: '0.74rem', color: 'var(--ink-muted)', textTransform: 'uppercase' }}>
                        Contrary Evidence URL:
                      </label>
                      <input
                        type="url"
                        placeholder="https://official-source.com/evidence"
                        value={evidenceUrl}
                        onChange={(e) => setEvidenceUrl(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '10px 12px',
                          background: 'var(--paper-sunk)',
                          border: 'var(--border-rule)',
                          borderRadius: 'var(--radius-control)',
                          fontFamily: 'var(--font-mono)',
                          fontSize: '0.82rem',
                          color: 'var(--ink)',
                          marginTop: 4,
                        }}
                      />
                    </div>

                    <button
                      onClick={handleChallenge}
                      disabled={actionLoading}
                      style={{
                        padding: '12px',
                        borderRadius: 'var(--radius-control)',
                        background: 'var(--ink)',
                        color: 'var(--paper)',
                        fontWeight: 600,
                        fontSize: 'var(--t-control)',
                      }}
                    >
                      Post Challenge Bond (10 GEN)
                    </button>

                    <div style={{ borderTop: 'var(--border-rule)', paddingTop: 14 }}>
                      <span style={{ fontSize: '0.74rem', color: 'var(--ink-muted)', textTransform: 'uppercase' }}>
                        Or Request Grand Appeal:
                      </span>
                      <p style={{ fontSize: '0.78rem', color: 'var(--ink-muted)', margin: '4px 0 10px' }}>
                        Doubles the validator set. Appeal bond: 25 GEN.
                      </p>
                      <button
                        onClick={handleAppeal}
                        disabled={actionLoading}
                        style={{
                          width: '100%',
                          padding: '10px',
                          borderRadius: 'var(--radius-control)',
                          border: 'var(--border-rule)',
                          background: 'var(--paper-sunk)',
                          color: 'var(--ink)',
                          fontWeight: 600,
                          fontSize: 'var(--t-control)',
                        }}
                      >
                        Appeal Ruling (25 GEN)
                      </button>
                    </div>
                  </div>
                ) : market.state === 'CHALLENGED' ? (
                  <div>
                    <div style={{
                      padding: 12,
                      background: 'var(--paper-sunk)',
                      borderRadius: 'var(--radius-control)',
                      marginBottom: 14,
                      fontSize: '0.82rem',
                    }}>
                      Market is under active challenge. Validators must re-evaluate original sources plus evidence.
                    </div>
                    <button
                      onClick={handleResolveChallenge}
                      disabled={actionLoading}
                      style={{
                        width: '100%',
                        padding: '12px',
                        background: 'var(--ink)',
                        color: 'var(--paper)',
                        borderRadius: 'var(--radius-control)',
                        fontWeight: 600,
                      }}
                    >
                      Trigger Resolve Challenge
                    </button>
                  </div>
                ) : market.state === 'APPEALED' ? (
                  <div>
                    <div style={{
                      padding: 12,
                      background: 'var(--paper-sunk)',
                      borderRadius: 'var(--radius-control)',
                      marginBottom: 14,
                      fontSize: '0.82rem',
                    }}>
                      Market is under appeal review with doubled validator set.
                    </div>
                    <button
                      onClick={handleResolveAppeal}
                      disabled={actionLoading}
                      style={{
                        width: '100%',
                        padding: '12px',
                        background: 'var(--ink)',
                        color: 'var(--paper)',
                        borderRadius: 'var(--radius-control)',
                        fontWeight: 600,
                      }}
                    >
                      Trigger Resolve Appeal
                    </button>
                  </div>
                ) : (
                  <div style={{ color: 'var(--ink-muted)', fontSize: '0.84rem' }}>
                    Contests and appeals can only be lodged when the market is in PROVISIONAL state.
                  </div>
                )}
              </div>
            )}

            {/* TAB 4: ORACLE & LIFECYCLE */}
            {activeTab === 'lifecycle' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <p style={{ fontSize: '0.82rem', color: 'var(--ink-muted)' }}>
                  GenLayer Intelligent Contracts allow anyone to trigger state transitions as a keeper.
                </p>

                {market.state === 'OPEN' && (
                  <button
                    onClick={handleCloseMarket}
                    disabled={actionLoading}
                    style={{
                      padding: '10px 14px',
                      background: 'var(--paper-sunk)',
                      border: 'var(--border-rule)',
                      borderRadius: 'var(--radius-control)',
                      color: 'var(--ink)',
                      fontWeight: 600,
                      fontSize: 'var(--t-control)',
                      textAlign: 'left',
                    }}
                  >
                    1. Close Market (After close time)
                  </button>
                )}

                {market.state === 'CLOSED' && (
                  <button
                    onClick={handleResolve}
                    disabled={actionLoading}
                    style={{
                      padding: '12px 14px',
                      background: 'var(--forest)',
                      color: 'var(--paper)',
                      borderRadius: 'var(--radius-control)',
                      fontWeight: 600,
                      fontSize: 'var(--t-control)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <span>2. Run Consensus Resolution</span>
                    <span style={{ fontSize: '0.72rem', background: 'rgba(255,255,255,0.2)', padding: '2px 6px', borderRadius: 2 }}>
                      Earn Bounty
                    </span>
                  </button>
                )}

                {market.state === 'PROVISIONAL' && (
                  <button
                    onClick={handleFinalize}
                    disabled={actionLoading}
                    style={{
                      padding: '10px 14px',
                      background: 'var(--ink)',
                      color: 'var(--paper)',
                      borderRadius: 'var(--radius-control)',
                      fontWeight: 600,
                      fontSize: 'var(--t-control)',
                    }}
                  >
                    3. Finalize Market (After appeal window)
                  </button>
                )}

                {market.state === 'FINAL' && (
                  <button
                    onClick={handleSettle}
                    disabled={actionLoading}
                    style={{
                      padding: '12px 14px',
                      background: 'var(--forest)',
                      color: 'var(--paper)',
                      borderRadius: 'var(--radius-control)',
                      fontWeight: 600,
                      fontSize: 'var(--t-control)',
                    }}
                  >
                    4. Settle Market & Write Precedent
                  </button>
                )}

                {market.state !== 'SETTLED' && market.state !== 'VOID' && (
                  <div style={{ borderTop: 'var(--border-rule)', paddingTop: 10, marginTop: 4 }}>
                    <button
                      onClick={handleVoidExpired}
                      disabled={actionLoading}
                      style={{
                        width: '100%',
                        padding: '8px',
                        background: 'transparent',
                        border: '1px dashed var(--hairline)',
                        color: 'var(--ink-muted)',
                        fontSize: '0.74rem',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      Void Expired (If stuck past grace deadline)
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Action Feedback Message */}
            {actionMessage && (
              <div
                style={{
                  marginTop: 16,
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-control)',
                  fontSize: '0.80rem',
                  fontFamily: 'var(--font-mono)',
                  background: actionMessage.type === 'success' ? 'var(--paper-sunk)' : 'rgba(200, 50, 50, 0.1)',
                  color: actionMessage.type === 'success' ? 'var(--forest)' : 'var(--ink)',
                  border: 'var(--border-rule)',
                }}
              >
                {actionMessage.text}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
