import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

import { setGlobalDispatcher, Agent } from 'undici';
setGlobalDispatcher(new Agent({ connect: { family: 4 } }));

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chains, createClient } from 'genlayer-js';
import dotenv from 'dotenv';
import { sql } from './db.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..', '..');

const RPC_URL = process.env.GENLAYER_RPC_URL || 'https://studio.genlayer.com/api';

const client = createClient({
  chain: chains.studionet,
  endpoint: RPC_URL,
});

let deployedContracts = null;
try {
  const deployedPath = path.join(rootDir, 'deployed_contracts.json');
  if (fs.existsSync(deployedPath)) {
    deployedContracts = JSON.parse(fs.readFileSync(deployedPath, 'utf-8'));
  }
} catch (e) {
  console.warn('Could not load deployed_contracts.json:', e.message);
}

export function getContractAddresses() {
  try {
    const deployedPath = path.join(rootDir, 'deployed_contracts.json');
    if (fs.existsSync(deployedPath)) {
      const parsed = JSON.parse(fs.readFileSync(deployedPath, 'utf-8'));
      if (parsed?.contracts?.VantageMarket?.address) {
        return {
          charter: parsed.contracts.VantageCharter.address,
          market: parsed.contracts.VantageMarket.address,
        };
      }
    }
  } catch {}
  return {
    charter: '0xBfB34B0b1dCa954823fBbefBAc815c4136d815e0',
    market: '0x96767e45874e697e5f2d059729890Ba5478e85b4',
  };
}

let isSyncing = false;

/**
 * Syncs contracts on GenLayer StudioNet into Neon PostgreSQL.
 */
export async function syncNow() {
  if (isSyncing) return;
  isSyncing = true;
  try {
    const { charter, market } = getContractAddresses();
    if (!market || !charter) return;

    // 1. Sync Markets
    try {
      const rawListing = await client.readContract({
        address: market,
        functionName: 'list_markets',
        args: [0, 50],
      });
      const listing = typeof rawListing === 'string' ? JSON.parse(rawListing || '{}') : rawListing;
      const marketsList = listing.markets || [];

      for (const m of marketsList) {
        if (!m || !m.market_id) continue;
        const marketId = m.market_id;

        // Fetch detailed spec & prices
        let spec = {};
        try {
          const rawSpec = await client.readContract({
            address: market,
            functionName: 'get_spec',
            args: [marketId],
          });
          spec = typeof rawSpec === 'string' ? JSON.parse(rawSpec || '{}') : (rawSpec || {});
        } catch {}

        let prices = [];
        try {
          const rawPrices = await client.readContract({
            address: market,
            functionName: 'get_prices',
            args: [marketId],
          });
          const parsed = typeof rawPrices === 'string' ? JSON.parse(rawPrices || '{}') : (rawPrices || {});
          prices = parsed.prices_bps || [];
        } catch {}

        // Check contest status
        try {
          const rawContest = await client.readContract({
            address: market,
            functionName: 'get_contest',
            args: [marketId],
          });
          if (rawContest) {
            const contest = typeof rawContest === 'string' ? JSON.parse(rawContest) : rawContest;
            if (contest && contest.market_id) {
              await sql`
                INSERT INTO contests (market_id, challenger, bond_wei, evidence_url, state, challenged_at, updated_at)
                VALUES (
                  ${contest.market_id},
                  ${contest.challenger || null},
                  ${contest.bond_wei || 0},
                  ${contest.evidence_url || ''},
                  ${contest.state || 'CHALLENGED'},
                  ${contest.challenged_at || 0},
                  CURRENT_TIMESTAMP
                )
                ON CONFLICT (market_id) DO UPDATE SET
                  state = EXCLUDED.state,
                  challenger = EXCLUDED.challenger,
                  bond_wei = EXCLUDED.bond_wei,
                  evidence_url = EXCLUDED.evidence_url,
                  updated_at = CURRENT_TIMESTAMP;
              `;
            }
          }
        } catch {}

        // Upsert market into DB
        await sql`
          INSERT INTO markets (
            market_id, author, question, restated_question, predicate_type,
            predicate, predicate_field, comparator, threshold, units,
            outcomes, sources, tags, fact_schema, spec_hash, charter_version,
            state, winning_outcome, reason_code, close_time, grace_deadline,
            challenge_deadline, appeal_deadline, volume_wei, collateral_wei,
            creator_fees_wei, reserves, prices_bps, created_at_chain, updated_at
          ) VALUES (
            ${marketId},
            ${m.author || ''},
            ${m.question || ''},
            ${m.restated_question || m.question || ''},
            ${m.predicate_type || 'event'},
            ${m.predicate || spec.predicate || ''},
            ${spec.predicate_field || ''},
            ${spec.comparator || ''},
            ${spec.threshold || ''},
            ${spec.units || ''},
            ${JSON.stringify(m.outcomes || [])}::jsonb,
            ${JSON.stringify(m.sources || spec.sources || [])}::jsonb,
            ${JSON.stringify(m.tags || spec.tags || [])}::jsonb,
            ${JSON.stringify(spec.fact_schema || {})}::jsonb,
            ${m.spec_hash || spec.spec_hash || ''},
            ${m.charter_version || 'v1'},
            ${m.state || 'OPEN'},
            ${m.winning_outcome !== undefined ? m.winning_outcome : -1},
            ${m.reason_code || ''},
            ${m.close_time || 0},
            ${m.grace_deadline || 0},
            ${m.challenge_deadline || 0},
            ${m.appeal_deadline || 0},
            ${m.volume_wei || 0},
            ${m.collateral_wei || 0},
            ${m.creator_fees_wei || 0},
            ${JSON.stringify(m.reserves || [])}::jsonb,
            ${JSON.stringify(prices)}::jsonb,
            ${m.created_at || 0},
            CURRENT_TIMESTAMP
          )
          ON CONFLICT (market_id) DO UPDATE SET
            state = EXCLUDED.state,
            winning_outcome = EXCLUDED.winning_outcome,
            reason_code = EXCLUDED.reason_code,
            volume_wei = EXCLUDED.volume_wei,
            collateral_wei = EXCLUDED.collateral_wei,
            creator_fees_wei = EXCLUDED.creator_fees_wei,
            reserves = EXCLUDED.reserves,
            prices_bps = EXCLUDED.prices_bps,
            challenge_deadline = EXCLUDED.challenge_deadline,
            appeal_deadline = EXCLUDED.appeal_deadline,
            updated_at = CURRENT_TIMESTAMP;
        `;
      }
    } catch (e) {
      console.error('Error syncing markets from GenLayer:', e.message);
    }

    // 2. Sync Charter Precedents
    try {
      const rawCharterStats = await client.readContract({
        address: charter,
        functionName: 'get_registry_stats',
        args: [],
      });
      const stats = typeof rawCharterStats === 'string' ? JSON.parse(rawCharterStats || '{}') : rawCharterStats;
      const count = Number(stats?.total_precedents || stats?.precedent_count || 0);

      // Only query precedent tags if precedents actually exist
      if (count > 0) {
        const sampleTags = ['crypto', 'finance', 'sports', 'weather', 'ethereum'];
        for (const tag of sampleTags) {
          try {
            const rawMatches = await client.readContract({
              address: charter,
              functionName: 'lookup_by_tag',
              args: [tag, 20],
            });
            const parsed = typeof rawMatches === 'string' ? JSON.parse(rawMatches || '{}') : (rawMatches || {});
            const precedents = parsed.matches || [];

            for (const p of precedents) {
              if (!p || !p.precedent_id) continue;
              await sql`
                INSERT INTO precedents (
                  precedent_id, market_id, spec_pattern, tags, outcome,
                  reason_code, predicate_type, charter_version, ruling_note,
                  recorded_by, sequence, recorded_at
                ) VALUES (
                  ${p.precedent_id},
                  ${p.market_id || ''},
                  ${p.spec_pattern || ''},
                  ${JSON.stringify(p.tags || [])}::jsonb,
                  ${String(p.outcome || '')},
                  ${p.reason_code || ''},
                  ${p.predicate_type || ''},
                  ${p.charter_version || 'v1'},
                  ${p.ruling_note || ''},
                  ${p.recorded_by || ''},
                  ${p.sequence || 0},
                  ${p.recorded_at || 0}
                )
                ON CONFLICT (precedent_id) DO NOTHING;
              `;
            }
          } catch {}
        }
      }
    } catch (e) {
      console.error('Error syncing charter precedents:', e.message);
    }
  } catch (err) {
    console.error('Indexer sync error:', err);
  } finally {
    isSyncing = false;
  }
}

/**
 * Starts background indexing loop.
 */
export function startContinuousSync(intervalMs = 20000) {
  console.log(`Starting background indexer (polling every ${intervalMs}ms)...`);
  syncNow();
  setInterval(() => {
    syncNow().catch(err => console.error('Continuous sync failed:', err.message));
  }, intervalMs);
}
