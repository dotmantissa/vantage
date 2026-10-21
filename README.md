# Vantage

An evidence-native prediction market built on GenLayer. Commitment markets distinguish delivery from announcements using criteria locked before trading. Numeric and event markets use the same public source policy, observation rules, disputes and individual claims.

V2 brings a responsive editorial trading desk with light/dark themes, discovery, reviewed creation, protected trading, source checkpoints, rulings, conditional scenarios, semantic case search and portfolio recovery. GenLayer validators review proposed rules and independently extract material evidence; deterministic contracts derive outcomes and account for collateral. The backend indexes, schedules and preserves consensus records. Users sign their own actions.

## Run locally

Use Node 22 and Python 3.12 or newer.

```sh
npm ci
npm --prefix frontend ci
pip install -r requirements.txt
cp .env.example .env
npm run dev
```

The interface remains usable as a read-only preview without credentials or V2 deployments. Configure Privy for signing, Neon for indexing, a keeper for scheduled actions, and R2 for retained consensus records. V1 and existing balances remain available at `/legacy` under the original StudioNet addresses.

## Verify

```sh
npm test
npm run lint
npm run test:consensus
npx playwright install --with-deps chromium
npm run test:browser
npm run build
```

`npm run test:runtime` runs disposable hosted GenVM probes. Passing direct tests is not proof of live consensus or funded beta operation. [Release gates](docs/V2_RELEASE_GATES.md) record actual verification and outstanding external gates.

## Deploy

`npm run deploy:v2` performs a fresh, recoverable deployment using `DEPLOYER_KEY`, waits for successful finalized execution, verifies code/schema and registrar authorization, and then writes the local deployment manifest. `npm run migrate:v2` adds V2 tables. `npm run worker` starts durable scheduling and indexing. [Operations](docs/V2_OPERATIONS.md) covers Fly process groups, R2, credentials, recovery and cutover.

V2 is a release candidate; no operational beta deployment or hosting cutover has occurred. StudioNet constructor/code probes passed before later checks hit its hourly limit; Bradbury currently denies RPC access from this host. External-service and funded full-lifecycle gates must pass before launch.

- [Architecture and compatibility](docs/V2_ARCHITECTURE.md)
- [Release evidence and limitations](docs/V2_RELEASE_GATES.md)
- [Operations runbook](docs/V2_OPERATIONS.md)
- [V1 reference](docs/V1_REFERENCE.md)
