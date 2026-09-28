import express from 'express';
import { sql } from '../db.js';
import { syncNow, getContractAddresses } from '../indexer.js';
import { requireAuth, optionalAuth } from '../auth.js';
import { chains, createClient } from 'genlayer-js';
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();
const RPC_URL = process.env.GENLAYER_RPC_URL || 'https://studio.genlayer.com/api';
const client = createClient({
  chain: chains.studionet,
  endpoint: RPC_URL,
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

    const rawPos = await client.readContract({
      address: marketContractAddress,
      functionName: 'get_position',
      args: [id, address],
    });
    const pos = typeof rawPos === 'string' ? JSON.parse(rawPos || '{}') : (rawPos || {});

    const rawBal = await client.readContract({
      address: marketContractAddress,
      functionName: 'get_balance',
      args: [address],
    });
    const bal = typeof rawBal === 'string' ? JSON.parse(rawBal || '{}') : (rawBal || {});

    res.json({
      market_id: id,
      holder: address,
      shares: pos.shares || {},
      lp_shares: pos.lp_shares || '0',
      claimable_balance_wei: bal.balance_wei || '0',
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
 * Trigger fast indexer sync
 */
router.post('/sync', async (req, res) => {
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
