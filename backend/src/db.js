import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

import { setGlobalDispatcher, Agent } from 'undici';
setGlobalDispatcher(new Agent({ connect: { family: 4 } }));

import { neon } from '@neondatabase/serverless';
import dotenv from 'dotenv';

dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('FATAL: DATABASE_URL is not set in environment.');
  process.exit(1);
}

export const sql = neon(DATABASE_URL);

/**
 * Initializes database tables if they do not already exist.
 */
export async function initDb() {
  console.log('Initializing Neon PostgreSQL database schema...');

  await sql`
    CREATE TABLE IF NOT EXISTS markets (
      market_id VARCHAR(64) PRIMARY KEY,
      author VARCHAR(64) NOT NULL,
      question TEXT NOT NULL,
      restated_question TEXT NOT NULL,
      predicate_type VARCHAR(32) NOT NULL,
      predicate TEXT,
      predicate_field VARCHAR(64),
      comparator VARCHAR(16),
      threshold VARCHAR(64),
      units VARCHAR(32),
      outcomes JSONB NOT NULL DEFAULT '[]'::jsonb,
      sources JSONB NOT NULL DEFAULT '[]'::jsonb,
      tags JSONB NOT NULL DEFAULT '[]'::jsonb,
      fact_schema JSONB DEFAULT '{}'::jsonb,
      spec_hash VARCHAR(128) NOT NULL,
      charter_version VARCHAR(32) NOT NULL DEFAULT 'v1',
      state VARCHAR(32) NOT NULL DEFAULT 'OPEN',
      winning_outcome INTEGER DEFAULT -1,
      reason_code VARCHAR(64) DEFAULT '',
      close_time BIGINT NOT NULL,
      grace_deadline BIGINT NOT NULL,
      challenge_deadline BIGINT DEFAULT 0,
      appeal_deadline BIGINT DEFAULT 0,
      volume_wei NUMERIC(78, 0) NOT NULL DEFAULT 0,
      collateral_wei NUMERIC(78, 0) NOT NULL DEFAULT 0,
      creator_fees_wei NUMERIC(78, 0) NOT NULL DEFAULT 0,
      reserves JSONB NOT NULL DEFAULT '[]'::jsonb,
      prices_bps JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at_chain BIGINT NOT NULL DEFAULT 0,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS precedents (
      precedent_id VARCHAR(64) PRIMARY KEY,
      market_id VARCHAR(64) NOT NULL,
      spec_pattern TEXT NOT NULL,
      tags JSONB NOT NULL DEFAULT '[]'::jsonb,
      outcome VARCHAR(64) NOT NULL,
      reason_code VARCHAR(64) NOT NULL,
      predicate_type VARCHAR(32) NOT NULL,
      charter_version VARCHAR(32) NOT NULL,
      ruling_note TEXT DEFAULT '',
      recorded_by VARCHAR(64) NOT NULL,
      sequence BIGINT DEFAULT 0,
      recorded_at BIGINT DEFAULT 0,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS trades (
      id SERIAL PRIMARY KEY,
      market_id VARCHAR(64) NOT NULL,
      trader VARCHAR(64) NOT NULL,
      action VARCHAR(16) NOT NULL,
      outcome_index INTEGER NOT NULL,
      shares NUMERIC(78, 0) NOT NULL,
      collateral_wei NUMERIC(78, 0) NOT NULL,
      fee_wei NUMERIC(78, 0) NOT NULL DEFAULT 0,
      tx_hash VARCHAR(128),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS users (
      address VARCHAR(64) PRIMARY KEY,
      privy_id VARCHAR(128),
      email VARCHAR(255),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS contests (
      market_id VARCHAR(64) PRIMARY KEY,
      challenger VARCHAR(64),
      bond_wei NUMERIC(78, 0) DEFAULT 0,
      evidence_url TEXT,
      state VARCHAR(32) NOT NULL,
      challenged_at BIGINT DEFAULT 0,
      appellant VARCHAR(64),
      appeal_bond_wei NUMERIC(78, 0) DEFAULT 0,
      appeal_round INTEGER DEFAULT 0,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `;

  // Indexes for fast querying
  await sql`CREATE INDEX IF NOT EXISTS idx_markets_state ON markets(state);`;
  await sql`CREATE INDEX IF NOT EXISTS idx_markets_tags ON markets USING gin (tags);`;
  await sql`CREATE INDEX IF NOT EXISTS idx_precedents_tags ON precedents USING gin (tags);`;
  await sql`CREATE INDEX IF NOT EXISTS idx_trades_market ON trades(market_id);`;
  await sql`CREATE INDEX IF NOT EXISTS idx_trades_trader ON trades(trader);`;

  console.log('✓ Database schema verified and indexed.');
}
