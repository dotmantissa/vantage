import express from 'express';
import { sql } from '../db.js';
import { syncNow, getContractAddresses } from '../indexer.js';
import { requireAuth, optionalAuth } from '../auth.js';
import { chains, createClient, createAccount } from 'genlayer-js';
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();
const RPC_URL = process.env.GENLAYER_RPC_URL || 'https://studio.genlayer.com/api';
const DEPLOYER_KEY = process.env.DEPLOYER_KEY;

const relayerAccount = DEPLOYER_KEY ? createAccount(DEPLOYER_KEY) : null;
const client = createClient({
  chain: chains.studionet,
  endpoint: RPC_URL,
  ...(relayerAccount ? { account: relayerAccount } : {}),
});

/**
 * Health check
 */
router.get('/health', async (req, res) => {
  try {
    const dbTest = await sql`SELECT 1 as ok`;
    const contracts = getContractAddresses();
    res.json({
      status: 'ok',
      network: 'studionet',
      chainId: 61999,
      rpcUrl: RPC_URL,
      contracts,
      database: dbTest?.[0]?.ok === 1 ? 'connected' : 'degraded',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

/**
 * List markets with filtering, searching, and pagination
 */
router.get('/markets', async (req, res) => {
  try {
    const { status, tag, search, sort = 'newest', limit = 50, offset = 0 } = req.query;

    let query = sql`SELECT * FROM markets WHERE 1=1`;

    if (status && status !== 'ALL') {
      query = sql`${query} AND state = ${status.toUpperCase()}`;
    }

    if (tag) {
      query = sql`${query} AND tags @> ${JSON.stringify([tag.toLowerCase()])}::jsonb`;
    }

    if (search) {
      const searchPattern = `%${search}%`;
      query = sql`${query} AND (question ILIKE ${searchPattern} OR restated_question ILIKE ${searchPattern})`;
    }

    if (sort === 'volume') {
      query = sql`${query} ORDER BY volume_wei DESC`;
    } else if (sort === 'closing_soon') {
      query = sql`${query} ORDER BY close_time ASC`;
    } else {
      query = sql`${query} ORDER BY created_at_chain DESC, created_at DESC`;
    }

    const parsedLimit = Math.min(Math.max(1, parseInt(limit, 10) || 50), 100);
    const parsedOffset = Math.max(0, parseInt(offset, 10) || 0);

    query = sql`${query} LIMIT ${parsedLimit} OFFSET ${parsedOffset}`;

    const rows = await query;
    const countResult = await sql`SELECT COUNT(*) as total FROM markets`;
    const total = parseInt(countResult[0]?.total || '0', 10);

    res.json({
      markets: rows,
      total,
      limit: parsedLimit,
      offset: parsedOffset,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Market details with live contract verification
 */
router.get('/markets/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const rows = await sql`SELECT * FROM markets WHERE market_id = ${id}`;
    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: 'Market not found' });
    }

    const market = rows[0];
    const { market: marketContractAddress } = getContractAddresses();

    // Query live prices and state directly from GenLayer Intelligent Contract
    let livePrices = market.prices_bps || [];
    let liveContest = null;

    try {
      const rawPrices = await client.readContract({
        address: marketContractAddress,
        functionName: 'get_prices',
        args: [id],
      });
      const parsed = typeof rawPrices === 'string' ? JSON.parse(rawPrices || '{}') : (rawPrices || {});
      livePrices = parsed.prices_bps || livePrices;
    } catch {}

    try {
      const contestRows = await sql`SELECT * FROM contests WHERE market_id = ${id}`;
      if (contestRows.length > 0) {
        liveContest = contestRows[0];
      }
    } catch {}

    res.json({
      ...market,
      prices_bps: livePrices,
      contest: liveContest,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * User position for a specific market
 */
router.get('/markets/:id/position/:address', async (req, res) => {
  try {
    const { id, address } = req.params;
    const { market: marketContractAddress } = getContractAddresses();
    const normAddr = address.toLowerCase();

    // 1. Read on-chain position
    let onChainShares = {};
    let onChainLp = '0';
    let claimableBal = '0';

    try {
      const rawPos = await client.readContract({
        address: marketContractAddress,
        functionName: 'get_position',
        args: [id, address],
      });
      const pos = typeof rawPos === 'string' ? JSON.parse(rawPos || '{}') : (rawPos || {});
      onChainShares = pos.shares || {};
      onChainLp = pos.lp_shares || '0';
    } catch (e) {
      console.warn(`[Position] on-chain get_position failed for ${address}:`, e.message);
    }

    try {
      const rawBal = await client.readContract({
        address: marketContractAddress,
        functionName: 'get_balance',
        args: [address],
      });
      const bal = typeof rawBal === 'string' ? JSON.parse(rawBal || '{}') : (rawBal || {});
      claimableBal = bal.balance_wei || '0';
    } catch {}

    // 2. Read DB positions table
    let dbShares = {};
    let dbLp = '0';
    try {
      const dbPos = await sql`
        SELECT * FROM positions
        WHERE market_id = ${id} AND LOWER(holder) = ${normAddr}
        LIMIT 1
      `;
      if (dbPos.length > 0) {
        dbShares = typeof dbPos[0].shares === 'string' ? JSON.parse(dbPos[0].shares) : (dbPos[0].shares || {});
        dbLp = dbPos[0].lp_shares || '0';
      }
    } catch {}

    // Merge positions
    const mergedShares = {};
    const allKeys = new Set([...Object.keys(onChainShares), ...Object.keys(dbShares)]);
    const isRelayer = relayerAccount && normAddr === relayerAccount.address.toLowerCase();

    for (const k of allKeys) {
      const onChainVal = BigInt(onChainShares[k] || '0');
      const dbVal = BigInt(dbShares[k] || '0');
      if (isRelayer) {
        mergedShares[k] = (onChainVal > 0n ? onChainVal : dbVal).toString();
      } else {
        mergedShares[k] = (onChainVal + dbVal).toString();
      }
    }

    const mergedLp = isRelayer
      ? (BigInt(onChainLp || '0') > 0n ? onChainLp : dbLp)
      : (BigInt(onChainLp || '0') + BigInt(dbLp || '0')).toString();

    // 3. Fallback: if both are 0, check trades table for this trader
    const hasAnyShares = Object.values(mergedShares).some(v => BigInt(v || '0') > 0n) || BigInt(mergedLp || '0') > 0n;
    if (!hasAnyShares) {
      try {
        const tradeRows = await sql`
          SELECT * FROM trades
          WHERE market_id = ${id} AND LOWER(trader) = ${normAddr}
          ORDER BY created_at ASC
        `;
        if (tradeRows.length > 0) {
          for (const t of tradeRows) {
            const idx = String(t.outcome_index);
            const sh = BigInt(t.shares || '0');
            const cur = BigInt(mergedShares[idx] || '0');
            if (t.action === 'BUY') {
              mergedShares[idx] = (cur + sh).toString();
            } else if (t.action === 'SELL') {
              mergedShares[idx] = (cur > sh ? cur - sh : 0n).toString();
            }
          }
        }
      } catch {}
    }

    res.json({
      market_id: id,
      holder: address,
      shares: mergedShares,
      lp_shares: mergedLp,
      claimable_balance_wei: claimableBal,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Trade history for a market
 */
router.get('/markets/:id/trades', async (req, res) => {
  try {
    const { id } = req.params;
    const trades = await sql`
      SELECT * FROM trades
      WHERE market_id = ${id}
      ORDER BY created_at DESC
      LIMIT 50
    `;
    res.json({ trades });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Record a new trade (called by frontend after on-chain transaction accepted)
 */
router.post('/trades', optionalAuth, async (req, res) => {
  try {
    const { market_id, trader, action, outcome_index, shares, collateral_amount_wei, fee_wei, tx_hash } = req.body;
    if (!market_id || !trader || !action) {
      return res.status(400).json({ error: 'Missing required trade parameters' });
    }

    const inserted = await sql`
      INSERT INTO trades (
        market_id, trader, action, outcome_index, shares,
        collateral_wei, fee_wei, tx_hash, created_at
      ) VALUES (
        ${market_id},
        ${trader.toLowerCase()},
        ${action.toUpperCase()},
        ${outcome_index || 0},
        ${shares || 0},
        ${collateral_amount_wei || 0},
        ${fee_wei || 0},
        ${tx_hash || ''},
        CURRENT_TIMESTAMP
      )
      RETURNING *;
    `;

    // Trigger fast sync
    syncNow().catch(() => {});

    res.status(201).json({ trade: inserted[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Active Vantage Charter rulebook and parameters
 */
router.get('/charter', async (req, res) => {
  try {
    const { charter: charterAddress } = getContractAddresses();

    const rawActive = await client.readContract({
      address: charterAddress,
      functionName: 'get_active_charter',
      args: [],
    });
    const charter = typeof rawActive === 'string' ? JSON.parse(rawActive || '{}') : (rawActive || {});

    const rawStats = await client.readContract({
      address: charterAddress,
      functionName: 'get_registry_stats',
      args: [],
    });
    const stats = typeof rawStats === 'string' ? JSON.parse(rawStats || '{}') : (rawStats || {});

    res.json({
      charter_address: charterAddress,
      charter,
      stats,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Precedent registry query with tag matching
 */
router.get('/precedents', async (req, res) => {
  try {
    const { tag, limit = 20 } = req.query;

    let rows;
    if (tag) {
      rows = await sql`
        SELECT * FROM precedents
        WHERE tags @> ${JSON.stringify([tag.toLowerCase()])}::jsonb
        ORDER BY recorded_at DESC, sequence DESC
        LIMIT ${parseInt(limit, 10) || 20}
      `;
    } else {
      rows = await sql`
        SELECT * FROM precedents
        ORDER BY recorded_at DESC, sequence DESC
        LIMIT ${parseInt(limit, 10) || 20}
      `;
    }

    const countRes = await sql`SELECT COUNT(*) as total FROM precedents`;
    res.json({
      precedents: rows,
      total: parseInt(countRes[0]?.total || '0', 10),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const MONTH_MAP = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11
};

/**
 * Natural language timeline parser
 */
function parseTimeline(q) {
  const now = new Date();
  const currentYear = now.getFullYear();

  // 1. Day Month Year e.g. "25th December, 2026", "25 Dec 2026", "25th of December 2026", "before 25th December, 2026"
  const dmyRegex = /(?:by|before|on|until)?\s*\b(\d{1,2})(?:st|nd|rd|th)?\s*(?:of\s*)?(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?),?\s*(\d{4})?\b/i;
  const dmyMatch = q.match(dmyRegex);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const monthKey = dmyMatch[2].toLowerCase();
    const month = MONTH_MAP[monthKey];
    const year = dmyMatch[3] ? parseInt(dmyMatch[3], 10) : currentYear;
    if (day >= 1 && day <= 31 && month !== undefined) {
      const d = new Date(Date.UTC(year, month, day, 23, 59, 0));
      if (!isNaN(d.getTime())) return { detected: true, date: d, text: dmyMatch[0].trim() };
    }
  }

  // 2. Month Day Year e.g. "December 31, 2026" or "Dec 31 2026"
  const mdyRegex = /(?:by|before|on|until)?\s*\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})?\b/i;
  const mdyMatch = q.match(mdyRegex);
  if (mdyMatch) {
    const monthKey = mdyMatch[1].toLowerCase();
    const month = MONTH_MAP[monthKey];
    const day = parseInt(mdyMatch[2], 10);
    const year = mdyMatch[3] ? parseInt(mdyMatch[3], 10) : currentYear;
    if (day >= 1 && day <= 31 && month !== undefined) {
      const d = new Date(Date.UTC(year, month, day, 23, 59, 0));
      if (!isNaN(d.getTime())) return { detected: true, date: d, text: mdyMatch[0].trim() };
    }
  }

  // 3. ISO Date e.g. "2026-12-25" or "before 2026-12-31"
  const isoRegex = /(?:by|before|on|until)?\s*\b(\d{4})-(\d{2})-(\d{2})\b/i;
  const isoMatch = q.match(isoRegex);
  if (isoMatch) {
    const year = parseInt(isoMatch[1], 10);
    const month = parseInt(isoMatch[2], 10) - 1;
    const day = parseInt(isoMatch[3], 10);
    const d = new Date(Date.UTC(year, month, day, 23, 59, 0));
    if (!isNaN(d.getTime())) return { detected: true, date: d, text: isoMatch[0].trim() };
  }

  // 4. Quarters e.g. "end of Q4 2026" or "Q1 2027"
  const qRegex = /\b(Q[1-4])\s*(?:of\s*)?(\d{4})\b/i;
  const qMatch = q.match(qRegex);
  if (qMatch) {
    const qNum = parseInt(qMatch[1].slice(1), 10);
    const year = parseInt(qMatch[2], 10);
    const quarterEndMonths = [2, 5, 8, 11]; // Mar, Jun, Sep, Dec (0-indexed)
    const quarterEndDays = [31, 30, 30, 31];
    const month = quarterEndMonths[qNum - 1];
    const day = quarterEndDays[qNum - 1];
    const d = new Date(Date.UTC(year, month, day, 23, 59, 0));
    return { detected: true, date: d, text: qMatch[0].trim() };
  }

  // 5. Month Year e.g. "by November 2026" or "by end of December 2026"
  const myRegex = /(?:by|before|in|until)?\s*(?:end\s+of\s+)?\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{4})\b/i;
  const myMatch = q.match(myRegex);
  if (myMatch) {
    const monthKey = myMatch[1].toLowerCase();
    const month = MONTH_MAP[monthKey];
    const year = parseInt(myMatch[2], 10);
    const lastDay = new Date(Date.UTC(year, month + 1, 0, 23, 59, 0));
    return { detected: true, date: lastDay, text: myMatch[0].trim() };
  }

  // 6. Year e.g. "by 2027" or "by end of 2026"
  const yrRegex = /(?:by|before|until)(?:\s+end\s+of)?\s+(\d{4})\b/i;
  const yrMatch = q.match(yrRegex);
  if (yrMatch) {
    const year = parseInt(yrMatch[1], 10);
    const d = new Date(Date.UTC(year, 11, 31, 23, 59, 0));
    return { detected: true, date: d, text: yrMatch[0].trim() };
  }

  return { detected: false, date: null, text: null };
}

/**
 * Validator source recommendation engine
 */
function recommendSources(q) {
  const text = q.toLowerCase();
  const sources = [];
  let rationale = '';

  // 1. Weather & Atmospheric Conditions
  if (/weather|temperature|hurricane|rainfall|rain|precipitation|snow|wind|celsius|fahrenheit|met office|noaa|cyclone|heatwave/i.test(text)) {
    if (/london|uk|britain|england|scotland|wales|heathrow|manchester|birmingham/i.test(text)) {
      sources.push('metoffice.gov.uk', 'open-meteo.com', 'ecmwf.int', 'bbc.com', 'accuweather.com');
      rationale = 'UK Met Office MIDAS/MetSys observational network, ECMWF European forecasts, and BBC Weather.';
    } else if (/paris|france|berlin|germany|rome|italy|madrid|spain|europe/i.test(text)) {
      sources.push('open-meteo.com', 'ecmwf.int', 'meteofrance.com', 'dwd.de', 'accuweather.com');
      rationale = 'European Centre for Medium-Range Weather Forecasts (ECMWF) and national meteorological observation feeds.';
    } else if (/tokyo|japan|china|beijing|asia/i.test(text)) {
      sources.push('jma.go.jp', 'open-meteo.com', 'accuweather.com', 'timeanddate.com');
      rationale = 'Japan Meteorological Agency (JMA), Open-Meteo observational archives, and AccuWeather.';
    } else if (/us|usa|united states|new york|california|texas|florida|chicago|miami|los angeles|noaa|nws/i.test(text)) {
      sources.push('api.weather.gov', 'noaa.gov', 'weather.com', 'accuweather.com');
      rationale = 'National Oceanic and Atmospheric Administration (NOAA) & US National Weather Service (NWS) observation APIs.';
    } else {
      sources.push('open-meteo.com', 'noaa.gov', 'wmo.int', 'weather.com', 'accuweather.com');
      rationale = 'World Meteorological Organization (WMO) Global Surface Network and Open-Meteo historical observations.';
    }
  }
  // 2. Cryptocurrencies & Digital Assets
  else if (/bitcoin|btc|ethereum|eth|solana|sol|crypto|token|defi|nft|market cap|coin|binance|doge|memecoin|uniswap|polygon/i.test(text)) {
    sources.push('api.coingecko.com', 'coinmarketcap.com', 'api.binance.com', 'coindesk.com');
    rationale = 'Live cryptocurrency spot and aggregate market feeds via CoinGecko, CoinMarketCap, and Binance APIs.';
  }
  // 3. Central Banking, Interest Rates & Macroeconomics
  else if (/fed|federal reserve|interest rate|inflation|cpi|unemployment|gdp|treasury|recession|fomc|central bank/i.test(text)) {
    if (/bank of england|boe|uk|gilt/i.test(text)) {
      sources.push('bankofengland.co.uk', 'ons.gov.uk', 'reuters.com', 'bloomberg.com');
      rationale = 'Bank of England Monetary Policy Committee records and UK Office for National Statistics (ONS).';
    } else if (/ecb|european central bank|eurozone/i.test(text)) {
      sources.push('ecb.europa.eu', 'bloomberg.com', 'reuters.com', 'ft.com');
      rationale = 'European Central Bank (ECB) Governing Council announcements and Eurostat statistical streams.';
    } else {
      sources.push('www.federalreserve.gov', 'bls.gov', 'bea.gov', 'treasury.gov');
      rationale = 'Official US Government economic statistical releases and Federal Reserve FOMC announcements.';
    }
  }
  // 4. Space, Astronomy & Aerospace
  else if (/nasa|space|spacex|moon|mars|astronomy|planet|orbit|launch|satellite|telescope|esa|artemis|exoplanet/i.test(text)) {
    sources.push('nasa.gov', 'esa.int', 'apnews.com', 'reuters.com');
    rationale = 'Official NASA and European Space Agency (ESA) bulletins, complemented by verified wire reports (Reuters, AP News).';
  }
  // 5. Software, Open Source & Developer Repos
  else if (/github|stars|repository|repo|release|commit|open source|npm|crates\.io|pypi|pull request/i.test(text)) {
    sources.push('api.github.com', 'github.com', 'npmjs.com', 'crates.io', 'pypi.org');
    rationale = 'GitHub REST API and package registry feeds for programmatic verification of releases, stargazers, and commits.';
  }
  // 6. Equities, Public Companies & Corporate Filings
  else if (/stock|shares|nasdaq|s&p|dow jones|apple|aapl|tesla|tsla|nvidia|nvda|microsoft|msft|amazon|amzn|google|googl|meta|sec|form 8-k|10-k|earnings/i.test(text)) {
    sources.push('sec.gov', 'bloomberg.com', 'finance.yahoo.com', 'reuters.com', 'wsj.com');
    rationale = 'US SEC EDGAR corporate filings and verified equity market pricing streams.';
  }
  // 7. Sports (Football, Basketball, Soccer, Tennis, Olympics)
  else if (/champions league|premier league|world cup|olympics|nba|nfl|fifa|uefa|formula 1|f1|tennis|grand slam|super bowl/i.test(text)) {
    sources.push('espn.com', 'bbc.com', 'reuters.com', 'uefa.com', 'apnews.com');
    rationale = 'Official sports federation records (UEFA/FIFA/NBA) and verified wire sports desks (BBC Sport, ESPN, Reuters).';
  }
  // 8. Elections, Politics & Legislation
  else if (/president|election|vote|senate|congress|parliament|prime minister|governor|court|supreme court/i.test(text)) {
    sources.push('reuters.com', 'apnews.com', 'bbc.com', 'ballotpedia.org');
    rationale = 'Verified neutral global wire services (Reuters, AP News, BBC) and official electoral registries.';
  }
  // 9. General News & Fact Verification Fallback
  else {
    sources.push('reuters.com', 'apnews.com', 'bbc.com', 'en.wikipedia.org');
    rationale = 'Consensus aggregation across global neutral news wires (Reuters, Associated Press) and verified public records.';
  }

  // Also include any specific web domains explicitly written into the user's question
  const domainMatches = text.match(/\b([a-z0-9-]+\.(?:gov|org|com|io|net|int|co\.uk))\b/gi) || [];
  domainMatches.forEach((d) => {
    const clean = d.toLowerCase();
    if (!sources.includes(clean)) {
      sources.unshift(clean);
    }
  });

  return { sources: Array.from(new Set(sources)).slice(0, 5), rationale };
}

/**
 * Resolvability Gate assessment
 */
function assessResolvability(q) {
  const text = q.trim();
  if (text.length < 12) {
    return {
      resolvable: false,
      reason: 'Question is too short to construct a verifiable prediction predicate.'
    };
  }

  // Purely subjective opinion queries
  if (/^(is|are)\s+.*\s+(better|good|bad|ugly|tasty|pretty|cool)\??$/i.test(text)) {
    return {
      resolvable: false,
      reason: 'Question appears purely subjective without objective criteria or an empirical data oracle.'
    };
  }

  // Inherently subjective claims without verifiable criteria
  const subjectiveMatch = text.match(/\b(make\s+a\s+(new\s+)?discovery|discover\s+(aliens|life|something|truth)|breakthrough|become\s+(popular|famous|successful|viral)|be\s+(popular|famous|successful|viral))\b/i);
  if (subjectiveMatch) {
    return {
      resolvable: false,
      reason: `The phrase "${subjectiveMatch[0]}" is inherently subjective and lacks an objective definition of what qualifies as verifiable evidence. Frame your question around specific quantifiable announcements or official releases (e.g. "Will NASA announce the discovery of an exoplanet before December 31, 2026?").`
    };
  }

  // Relative timeframe without concrete calendar date
  const relativeMatch = text.match(/\b(in|within)\s+the\s+next\s+(\d+)\s+(days?|weeks?|months?)\b/i);
  if (relativeMatch) {
    const amount = parseInt(relativeMatch[2], 10);
    const unit = relativeMatch[3].toLowerCase();
    const d = new Date();
    if (unit.startsWith('day')) d.setDate(d.getDate() + amount);
    else if (unit.startsWith('week')) d.setDate(d.getDate() + amount * 7);
    else if (unit.startsWith('month')) d.setMonth(d.getMonth() + amount);
    const dateStr = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

    return {
      resolvable: false,
      reason: `The phrase "${relativeMatch[0]}" cannot be pinned to an immutable UTC timestamp on-chain from the text alone. Please use a concrete calendar date (e.g. "before ${dateStr}").`,
      suggested_rewrite: text.replace(relativeMatch[0], `before ${dateStr}`),
    };
  }

  // Constructive optimization suggestions for vague observation benchmarks
  let suggestedRefinement = null;
  let optimizationTip = null;

  // Weather station vagueness check
  if (/weather|rain|precipitation|snow|temperature/i.test(text)) {
    if (/\b(?:at\s+)?a\s+(?:central\s+)?[a-z\s]*weather\s+station\b/i.test(text) || /\bsomewhere\s+in\b/i.test(text) || /\ba\s+local\s+station\b/i.test(text)) {
      if (/london/i.test(text)) {
        suggestedRefinement = text
          .replace(/a\s+weather\s+dataset\s+retrievable\s+from\s+an\s+allowed\s+source/gi, 'official meteorological observations')
          .replace(/\b(?:at\s+)?a\s+(?:central\s+)?london\s+weather\s+station\b/gi, 'at the London St. James’s Park station (UK Met Office)')
          .replace(/\b(?:at\s+)?a\s+(?:central\s+)?weather\s+station\b/gi, 'at the London St. James’s Park station (UK Met Office)');
        optimizationTip = 'Specifying the official primary observation point (London St. James’s Park) guarantees 100% agreement across all independent GenLayer validator nodes.';
      } else if (/new york|nyc/i.test(text)) {
        suggestedRefinement = text
          .replace(/\b(?:at\s+)?a\s+(?:central\s+)?[a-z\s]*weather\s+station\b/gi, 'at the NYC Central Park station (KNYC)');
        optimizationTip = 'Specifying NYC Central Park (KNYC) ensures unanimous consensus from NOAA and NWS oracles.';
      }
    }
  }

  return {
    resolvable: true,
    confidence: suggestedRefinement ? 0.92 : 0.98,
    suggested_refinement: suggestedRefinement,
    optimization_tip: optimizationTip,
  };
}

/**
 * Validator Analysis Engine for Market Questions
 * Evaluates live data fetchability, decides authoritative sources, and detects timelines.
 */
router.post('/validate-market', async (req, res) => {
  try {
    const { question } = req.body;
    if (!question || typeof question !== 'string') {
      return res.status(400).json({ error: 'Question string is required' });
    }

    const { resolvable, reason, confidence, suggested_refinement, optimization_tip } = assessResolvability(question);
    if (!resolvable) {
      return res.json({
        resolvable: false,
        reason,
        sources: [],
        timeline_detected: false,
      });
    }

    const { sources, rationale } = recommendSources(question);
    const timeline = parseTimeline(question);

    const isNumeric = /\$|\bprice\b|\babove\b|\bgreater\b|\bhigher\b|\bbelow\b|\bless\b|\bexceed\b|\%|\bmarket cap\b|\bstars\b|\brate\b/i.test(question);

    const words = question.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/);
    const stopWords = new Set(['will', 'the', 'be', 'by', 'before', 'in', 'on', 'at', 'of', 'to', 'a', 'an', 'is', 'reach', 'exceed', 'than']);
    const tags = Array.from(new Set(words.filter(w => w.length > 2 && !stopWords.has(w)))).slice(0, 5);

    let defaultCloseIso = null;
    if (timeline.detected && timeline.date) {
      defaultCloseIso = timeline.date.toISOString().slice(0, 16);
    }

    res.json({
      resolvable: true,
      confidence: confidence || 0.95,
      predicate_type: isNumeric ? 'numeric' : 'event',
      sources,
      source_rationale: rationale,
      suggested_refinement,
      optimization_tip,
      timeline_detected: timeline.detected,
      timeline_text: timeline.text,
      detected_close_iso: defaultCloseIso,
      outcomes: ['YES', 'NO'],
      tags,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Aggregate platform statistics
 */
router.get('/stats', async (req, res) => {
  try {
    const { market: marketAddress, charter: charterAddress } = getContractAddresses();

    let onChainStats = {};
    try {
      const raw = await client.readContract({
        address: marketAddress,
        functionName: 'get_stats',
        args: [],
      });
      onChainStats = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {});
    } catch {}

    const marketCounts = await sql`
      SELECT 
        COUNT(*) as total_markets,
        COUNT(CASE WHEN state = 'OPEN' THEN 1 END) as open_markets,
        COUNT(CASE WHEN state = 'PROVISIONAL' THEN 1 END) as provisional_markets,
        COUNT(CASE WHEN state = 'CHALLENGED' THEN 1 END) as challenged_markets,
        COUNT(CASE WHEN state = 'SETTLED' THEN 1 END) as settled_markets,
        COUNT(CASE WHEN state = 'VOID' THEN 1 END) as void_markets,
        COALESCE(SUM(volume_wei), 0) as total_volume_wei,
        COALESCE(SUM(collateral_wei), 0) as total_collateral_wei
      FROM markets
    `;

    const precedentCount = await sql`SELECT COUNT(*) as total FROM precedents`;

    res.json({
      market_address: marketAddress,
      charter_address: charterAddress,
      on_chain: onChainStats,
      aggregates: {
        total_markets: parseInt(marketCounts[0]?.total_markets || '0', 10),
        open_markets: parseInt(marketCounts[0]?.open_markets || '0', 10),
        provisional_markets: parseInt(marketCounts[0]?.provisional_markets || '0', 10),
        challenged_markets: parseInt(marketCounts[0]?.challenged_markets || '0', 10),
        settled_markets: parseInt(marketCounts[0]?.settled_markets || '0', 10),
        void_markets: parseInt(marketCounts[0]?.void_markets || '0', 10),
        total_volume_wei: marketCounts[0]?.total_volume_wei?.toString() || '0',
        total_collateral_wei: marketCounts[0]?.total_collateral_wei?.toString() || '0',
        total_precedents: parseInt(precedentCount[0]?.total || '0', 10),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Helper to extract contract return payload from transaction consensus data
 */
function extractContractResult(fullTx) {
  try {
    const validators = fullTx?.consensus_data?.validators || [];
    for (const v of validators) {
      if (v?.result) {
        try {
          const decoded = Buffer.from(v.result, 'base64').toString('utf8');
          const jsonMatch = decoded.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed && typeof parsed === 'object') {
              return parsed;
            }
          }
        } catch {}
      }
    }
    const leaderReceipt = fullTx?.consensus_data?.leader_receipt || [];
    for (const lr of leaderReceipt) {
      if (lr?.result) {
        try {
          const raw = typeof lr.result === 'string' ? lr.result : JSON.stringify(lr.result);
          const decoded = Buffer.from(raw, 'base64').toString('utf8');
          const jsonMatch = decoded.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed && typeof parsed === 'object') {
              return parsed;
            }
          }
        } catch {}
      }
    }
  } catch (e) {
    console.warn('[Relay] Failed to extract contract result from consensus data:', e.message);
  }
  return null;
}

/**
 * Relayer execution engine: executes on-chain intelligent contract calls via deployer key
 */
async function handleRelayRequest(req, res) {
  try {
    const { action, method, market_id, args = [], value_wei = '0', caller } = req.body;
    const { market: marketContractAddress } = getContractAddresses();

    if (!relayerAccount) {
      return res.status(500).json({ error: 'Relayer private key (DEPLOYER_KEY) is not configured in backend environment' });
    }

    if (action === 'compile_market') {
      const { question, close_time, seed_liquidity_wei, extra_sources_csv, value_wei: createValueWei, author } = req.body;
      if (!question || !close_time) {
        return res.status(400).json({ error: 'Missing required market creation parameters' });
      }

      console.log(`[Relay] Broadcasting compile_market for "${question}"...`);
      const txHash = await client.writeContract({
        address: marketContractAddress,
        functionName: 'compile_market',
        args: [
          String(question).trim(),
          Number(close_time),
          String(seed_liquidity_wei || '5000000000000000000'),
          String(extra_sources_csv || ''),
        ],
        value: BigInt(createValueWei || '10000000000000000000'),
      });

      console.log(`[Relay] compile_market tx broadcast: ${txHash}. Returning async pending response.`);
      return res.json({
        success: true,
        pending: true,
        tx_hash: txHash,
        message: 'Market compilation transaction broadcast to GenLayer StudioNet. Awaiting validator consensus...',
      });
    }

    if (!method) {
      await syncNow();
      return res.json({ message: 'Sync complete' });
    }

    // Prepare arguments with appropriate type conversions
    const resolvedArgs = (args || []).map((arg, idx) => {
      if (['buy', 'sell'].includes(method) && idx === 1) {
        return Number(arg);
      }
      return String(arg);
    });

    console.log(`[Relay] Executing ${method} on market ${market_id} with value ${value_wei} wei...`);

    const txHash = await client.writeContract({
      address: marketContractAddress,
      functionName: method,
      args: resolvedArgs,
      value: BigInt(value_wei || '0'),
    });

    console.log(`[Relay] Tx broadcast: ${txHash}. Awaiting validator consensus...`);

    const receipt = await client.waitForTransactionReceipt({
      hash: txHash,
      status: 'ACCEPTED',
      interval: 2000,
      retries: 45,
    });

    console.log(`[Relay] Tx confirmed on StudioNet: ${txHash}`);

    let fullTx = null;
    let contractResult = null;
    try {
      fullTx = await client.getTransaction({ hash: txHash });
      contractResult = extractContractResult(fullTx);
      if (contractResult) {
        console.log(`[Relay] Decoded contract result:`, contractResult);
      }
    } catch (e) {
      console.warn('[Relay] Failed to query full tx consensus data:', e.message);
    }

    const effectiveCaller = String(caller || relayerAccount.address).toLowerCase();

    // If trade action, record in positions and trades tables
    if (method === 'buy' || method === 'sell') {
      const outcomeIdx = Number(args[1] || 0);
      const isBuy = method === 'buy';

      let tradeShares = 0n;
      if (isBuy && contractResult?.shares_out) {
        tradeShares = BigInt(contractResult.shares_out);
      } else if (!isBuy && contractResult?.shares_burned) {
        tradeShares = BigInt(contractResult.shares_burned);
      } else if (!isBuy && args[2]) {
        tradeShares = BigInt(args[2]);
      } else if (isBuy && value_wei) {
        tradeShares = BigInt(value_wei);
      }

      // Update DB position for effectiveCaller
      try {
        const existing = await sql`
          SELECT * FROM positions WHERE market_id = ${market_id} AND LOWER(holder) = ${effectiveCaller} LIMIT 1
        `;
        let userShares = existing[0]?.shares || {};
        if (typeof userShares === 'string') userShares = JSON.parse(userShares);
        const prevLp = existing[0]?.lp_shares || '0';

        const prevShares = BigInt(userShares[String(outcomeIdx)] || '0');
        if (isBuy) {
          userShares[String(outcomeIdx)] = (prevShares + tradeShares).toString();
        } else {
          userShares[String(outcomeIdx)] = (prevShares > tradeShares ? prevShares - tradeShares : 0n).toString();
        }

        await sql`
          INSERT INTO positions (market_id, holder, shares, lp_shares, updated_at)
          VALUES (${market_id}, ${effectiveCaller}, ${JSON.stringify(userShares)}::jsonb, ${prevLp}, CURRENT_TIMESTAMP)
          ON CONFLICT (market_id, holder) DO UPDATE SET
            shares = EXCLUDED.shares,
            updated_at = CURRENT_TIMESTAMP;
        `;
      } catch (posErr) {
        console.warn('[Relay] Failed to update positions cache:', posErr.message);
      }

      // Record trade history
      try {
        const tradeCollateral = contractResult?.collateral_in || contractResult?.collateral_out || value_wei || '0';
        const tradeFee = contractResult?.fee_wei || '0';
        await sql`
          INSERT INTO trades (
            market_id, trader, action, outcome_index, shares, collateral_wei, fee_wei, tx_hash, created_at
          ) VALUES (
            ${market_id}, ${effectiveCaller}, ${method.toUpperCase()}, ${outcomeIdx},
            ${tradeShares.toString()}, ${tradeCollateral}, ${tradeFee}, ${txHash}, CURRENT_TIMESTAMP
          );
        `;
      } catch (tradeErr) {
        console.warn('[Relay] Failed to record trade:', tradeErr.message);
      }
    } else if (method === 'add_liquidity' || method === 'remove_liquidity') {
      const isAdd = method === 'add_liquidity';
      try {
        const existing = await sql`
          SELECT * FROM positions WHERE market_id = ${market_id} AND LOWER(holder) = ${effectiveCaller} LIMIT 1
        `;
        let prevShares = existing[0]?.shares || {};
        if (typeof prevShares === 'string') prevShares = JSON.parse(prevShares);
        let curLp = BigInt(existing[0]?.lp_shares || '0');
        let diff = 0n;
        if (isAdd && contractResult?.added_wei) {
          diff = BigInt(contractResult.added_wei);
        } else if (!isAdd && contractResult?.lp_shares_burned) {
          diff = BigInt(contractResult.lp_shares_burned);
        } else {
          diff = BigInt(value_wei || args[1] || '0');
        }
        let nextLp = isAdd ? curLp + diff : (curLp > diff ? curLp - diff : 0n);

        await sql`
          INSERT INTO positions (market_id, holder, shares, lp_shares, updated_at)
          VALUES (${market_id}, ${effectiveCaller}, ${JSON.stringify(prevShares)}::jsonb, ${nextLp.toString()}, CURRENT_TIMESTAMP)
          ON CONFLICT (market_id, holder) DO UPDATE SET
            lp_shares = EXCLUDED.lp_shares,
            updated_at = CURRENT_TIMESTAMP;
        `;
      } catch (lpErr) {
        console.warn('[Relay] Failed to update LP position:', lpErr.message);
      }
    }

    // Refresh database indexing
    await syncNow();

    res.json({
      success: true,
      tx_hash: txHash,
      status: receipt?.status || 'ACCEPTED',
      method,
      contract_result: contractResult,
    });
  } catch (err) {
    console.error('[Relay] Error executing transaction:', err);
    res.status(500).json({ error: err.message || 'Failed to execute transaction on GenLayer' });
  }
}

/**
 * Transaction Relay: executes on-chain writeContract calls
 */
router.post('/relay', handleRelayRequest);

/**
 * Query status of an on-chain transaction
 */
async function handleRelayStatusRequest(req, res) {
  try {
    const { txHash } = req.params;
    if (!txHash) {
      return res.status(400).json({ error: 'Transaction hash is required' });
    }

    const tx = await client.getTransaction({ hash: txHash });
    if (!tx) {
      return res.status(404).json({ error: 'Transaction not found on StudioNet' });
    }

    const statusCode = Number(tx.status);
    const statusStr = String(tx.status || tx.statusName || '').toUpperCase();
    console.log(`[RelayStatus] Tx ${txHash} status: ${tx.status} (${tx.statusName || statusCode})`);

    const isAccepted = statusCode === 5 || statusCode === 7 || statusStr === 'ACCEPTED' || statusStr === 'FINALIZED';
    const isFailed = statusCode === 6 || statusCode === 8 || statusCode === 12 || statusCode === 13 ||
      statusStr === 'UNDETERMINED' || statusStr === 'CANCELED' || statusStr === 'VALIDATORS_TIMEOUT' || statusStr === 'LEADER_TIMEOUT';

    if (isFailed) {
      return res.json({
        status: 'FAILED',
        tx_status: statusCode,
        tx_hash: txHash,
        error: `Transaction consensus failed on StudioNet with status: ${tx.statusName || tx.status}`,
      });
    }

    // Status 5: ACCEPTED or Status 7: FINALIZED (consensus achieved)
    if (isAccepted) {
      const contractResult = extractContractResult(tx);
      console.log(`[RelayStatus] Tx ${txHash} contractResult:`, contractResult);

      if (contractResult && contractResult.created === false) {
        return res.json({
          status: 'REJECTED',
          created: false,
          tx_hash: txHash,
          reason: contractResult.reason || 'NOT_RESOLVABLE',
          problems: contractResult.problems || [],
          suggested_rewrites: contractResult.suggested_rewrites || [],
          refunded_wei: contractResult.refunded_wei || '0',
          restated_question: contractResult.restated_question || '',
          error: `On-chain validators rejected compilation: ${(contractResult.problems || []).join('; ') || 'Resolvability criteria not satisfied.'}`,
        });
      }

      try {
        await syncNow();
      } catch (syncErr) {
        console.warn(`[RelayStatus] Indexer sync error after consensus:`, syncErr.message);
      }

      const newMarketId = contractResult?.market_id;
      let matchedMarket = null;
      if (newMarketId) {
        try {
          const rows = await sql`SELECT * FROM markets WHERE market_id = ${newMarketId}`;
          matchedMarket = rows[0] || null;
        } catch (dbErr) {
          console.warn(`[RelayStatus] DB query error:`, dbErr.message);
        }
      }
      if (!matchedMarket) {
        try {
          const latestMarkets = await sql`SELECT * FROM markets ORDER BY created_at_chain DESC LIMIT 1`;
          matchedMarket = latestMarkets[0] || null;
        } catch (dbErr) {
          console.warn(`[RelayStatus] DB query fallback error:`, dbErr.message);
        }
      }

      return res.json({
        status: 'SUCCESS',
        created: true,
        tx_hash: txHash,
        market_id: newMarketId || matchedMarket?.market_id,
        market: matchedMarket,
      });
    }

    // Status 0: PENDING, 1: PROPOSING, 2: COMMITTING, 3: REVEALING, 4: FINALIZING
    const stepLabels = {
      0: 'Broadcasting transaction across StudioNet...',
      1: 'Leader node compiling predicate & checking gate...',
      2: 'AI validators independently verifying specification...',
      3: 'Consensus votes accumulating across validator nodes...',
      4: 'Consensus finalized, confirming on ledger...',
    };

    return res.json({
      status: 'PENDING',
      tx_status: statusCode,
      tx_hash: txHash,
      message: stepLabels[statusCode] || `Validators verifying specification (status: ${tx.statusName || statusCode})...`,
    });
  } catch (err) {
    console.error('[RelayStatus] Error:', err);
    res.status(500).json({ error: err.message });
  }
}

router.get('/relay/status/:txHash', handleRelayStatusRequest);

/**
 * Trigger fast indexer sync (also handles forwarded action/method requests)
 */
router.post('/sync', async (req, res) => {
  if (req.body && (req.body.method || req.body.action)) {
    return handleRelayRequest(req, res);
  }
  try {
    await syncNow();
    res.json({ message: 'Sync complete' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Authenticated user profile
 */
router.get('/users/profile', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    if (user.address) {
      await sql`
        INSERT INTO users (address, privy_id, email, updated_at)
        VALUES (${user.address}, ${user.userId}, ${user.email || null}, CURRENT_TIMESTAMP)
        ON CONFLICT (address) DO UPDATE SET
          privy_id = EXCLUDED.privy_id,
          email = EXCLUDED.email,
          updated_at = CURRENT_TIMESTAMP;
      `;
    }
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
