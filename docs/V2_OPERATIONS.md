# V2 operations

Use Node 22 and Python 3.12+. Install with `npm ci`, `npm --prefix frontend ci`, and `pip install -r requirements.txt`. Copy `.env.example` to `.env` and populate credentials through your secret manager. `npm run dev` starts the API and frontend. Without deployment or Privy configuration, V2 offers an honest read-only creation preview. V1 remains reachable at `/legacy`.

## Fresh contract deployment

Run all local checks first. `npm run deploy:v2` deploys CharterV2, MemoryV2 and MarketV2 and authorizes the market as the memory registrar. It requires `DEPLOYER_KEY`, uses the shared chain definition, waits for successful **finalized execution**, checks exact source and schemas, and writes `deployed_v2.json` only after verification. A pending journal saves every broadcast hash and source digest. Resume the same command after interruption. If the journal records a broadcasting intent without a hash, reconcile the sender's nonce and chain transactions before continuing. Never delete the journal merely to retry an uncertain broadcast.

The manifest and pending journal are ignored local deployment artifacts, never fabricated addresses. Mount the verified manifest at `/app/deployed_v2.json` in the runtime or set `V2_DEPLOYMENT_FILE` to its mounted path. The deployer key belongs only in the deployment environment. Fund Bradbury accounts through the GenLayer faucet; StudioNet is gasless. Bradbury RPC access and every beta release gate in `V2_RELEASE_GATES.md` must pass before cutover.

## API, worker and database

Set `DATABASE_URL` to Neon and run `npm run migrate:v2`. Migrations add V2 tables and indexes without rewriting V1. Back up the database before release. `npm run worker` runs the durable index/evidence/lifecycle/archive jobs; it requires a funded `KEEPER_KEY` on the selected network. User trades are signed by users, never by that key.

The Docker image serves the Vite application and API from one origin. Build using `--build-arg VITE_PRIVY_APP_ID=… --build-arg VITE_VANTAGE_NETWORK=…`; these are public identifiers, not secrets. Register the intended domain and both network chains with Privy. Configure `PRIVY_APP_ID`/`PRIVY_APP_SECRET` only server side and `CORS_ORIGINS` for the actual frontend origin. Development-only `LOCAL_DEMO_AUTH=1` is rejected in production.

`ops/fly.toml` defines separate web and worker process groups. Choose the actual Fly app name and mount the verified manifest, set secrets with Fly, deploy, and scale one persistent worker and at least one web machine. The file is a deployable configuration template; no Fly release has been performed. Keep V1 hosting available during a controlled cutover and document its URL for users.

`GET /api/v2/health` reports deployment, jobs, index time and archive configuration. Alert on failed jobs, stale indexing, unavailable RPC, and exhausted evidence budgets. Transactions that remain pending are tracked again by their saved hash. Index replay removes recomputed activity/evidence tails; only identical finalized chain records receive a finality marker. API cache prices remain estimates; the contract checks each signed trade's minimum output.

## Evidence retention

Configure an R2 bucket, endpoint, access key and secret key. The worker uploads content-addressed consensus evidence JSON with conditional creation. Missing configuration and failed uploads produce failed jobs and remain visible in health. Changed chain evidence clears its archive reference; an old upload cannot replace a newer record's reference. Do not set automatic expiration on retained records.

The archive stores the **consensus record**, including accepted source hash, original URL, upstream record identity, timestamps, criteria and citations. It does not claim to be a copy of original web/screenshot bytes. An independent re-fetch cannot prove that it captured the bytes validators read. Preserve upstream immutable records where available; full original-media archival needs a consensus-linked acquisition service and is an outstanding release enhancement.

## Recovery

Job claims use `FOR UPDATE SKIP LOCKED`, leases and bounded retry. A persisted broadcast hash resumes tracking. A broadcasting intent without a hash is marked failed (`UNCERTAIN_BROADCAST`) and must be reconciled manually against sender/nonce/history before updating that job's payload. This deliberately stops an uncertain job; the operator must not reset it on the assumption that an RPC error means rejection. Different lifecycle revisions have separate keys; one successful action is not repeatedly scheduled each minute.

After fixing credentials or an RPC outage, reset appropriate failed jobs to pending with their hashes/payload intact. Track application disputes separately from native transaction appeals. Reconcile replayed chain state before reopening trading. Rollback frontend/backend releases independently, retaining all V2 tables and deployment records and the V1 archive. Never repoint V2 at V1 contracts.
