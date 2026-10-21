// Additive migration; V1 tables and data remain intact.
export async function migrateV2(sql) {
  await sql`CREATE TABLE IF NOT EXISTS v2_markets (network TEXT NOT NULL, contract TEXT NOT NULL, market_id TEXT NOT NULL, body JSONB NOT NULL, prices JSONB NOT NULL DEFAULT '[]', indexed_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(network,contract,market_id))`;
  await sql`CREATE TABLE IF NOT EXISTS v2_activity (network TEXT NOT NULL, contract TEXT NOT NULL, sequence BIGINT NOT NULL, market_id TEXT NOT NULL, body JSONB NOT NULL, finalized BOOLEAN NOT NULL DEFAULT FALSE, PRIMARY KEY(network,contract,sequence))`;
  await sql`CREATE TABLE IF NOT EXISTS v2_evidence (network TEXT NOT NULL, contract TEXT NOT NULL, evidence_id TEXT NOT NULL, market_id TEXT NOT NULL, body JSONB NOT NULL, archive_key TEXT, indexed_at TIMESTAMPTZ DEFAULT now(), PRIMARY KEY(network,contract,evidence_id))`;
  await sql`CREATE TABLE IF NOT EXISTS v2_precedents (network TEXT NOT NULL, contract TEXT NOT NULL, precedent_id TEXT NOT NULL, body JSONB NOT NULL, PRIMARY KEY(network,contract,precedent_id))`;
  await sql`CREATE TABLE IF NOT EXISTS v2_transactions (network TEXT NOT NULL, tx_hash TEXT NOT NULL, actor TEXT NOT NULL, method TEXT NOT NULL, market_id TEXT, body JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT now(), PRIMARY KEY(network,tx_hash))`;
  await sql`ALTER TABLE v2_transactions ADD COLUMN IF NOT EXISTS contract TEXT`;
  await sql`CREATE TABLE IF NOT EXISTS v2_watchlists (actor TEXT NOT NULL, network TEXT NOT NULL, market_id TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT now(), PRIMARY KEY(actor,network,market_id))`;
  await sql`CREATE TABLE IF NOT EXISTS v2_jobs (id BIGSERIAL PRIMARY KEY, dedupe_key TEXT UNIQUE NOT NULL, kind TEXT NOT NULL, payload JSONB NOT NULL, state TEXT NOT NULL DEFAULT 'pending', attempts INT NOT NULL DEFAULT 0, run_at TIMESTAMPTZ NOT NULL DEFAULT now(), lease_until TIMESTAMPTZ, lease_owner TEXT, last_error TEXT, updated_at TIMESTAMPTZ DEFAULT now())`;
  await sql`CREATE TABLE IF NOT EXISTS v2_archives (archive_key TEXT PRIMARY KEY, body TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`;
  await sql`CREATE TABLE IF NOT EXISTS v2_service_runs (owner TEXT PRIMARY KEY, started_at TIMESTAMPTZ NOT NULL, finished_at TIMESTAMPTZ, body JSONB NOT NULL DEFAULT '{}')`;
  await sql`CREATE TABLE IF NOT EXISTS v2_service_locks (name TEXT PRIMARY KEY, owner TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL)`;
  await sql`CREATE INDEX IF NOT EXISTS v2_market_state ON v2_markets ((body->>'state'))`;
  await sql`CREATE INDEX IF NOT EXISTS v2_activity_market ON v2_activity(network,contract,market_id,sequence)`;
  await sql`CREATE INDEX IF NOT EXISTS v2_jobs_due ON v2_jobs(state,run_at)`;
}
