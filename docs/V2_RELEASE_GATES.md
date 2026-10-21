# V2 release evidence — 2026-10-21

This is an implemented release candidate. It is not an approved production deployment.

| Gate | Evidence / state |
| --- | --- |
| Pinned contract lint | Five V1/V2 contracts pass GenVM lint and SDK validation. |
| Business logic | Direct suite covers V1 preservation, reviewed activation, exact hashes, provenance, independent publisher policy, numeric threshold precision, per-criterion support, evidence budget reservation, protected quotes, AMM conservation, disputes, conditions and individual payouts. 168 tests pass. |
| Independent validators | Five-validator GLSim tests exercise review, evidence, trading and material disagreement with exhausted rotations. Controlled web/LLM inputs; no claim of live model verification. |
| Browser | Six desktop/mobile browser cases covering discovery, theme, real market workspace/rules/ruling, persisted creation recovery and empty preview tests pass. Screenshots visually reviewed. Wallet signing tested structurally; live Privy funded-wallet verification remains required. |
| API/jobs | 21 automated tests exercise auth fail-closed, execution status, durable leases, archive content identity and uncertain-broadcast recovery. External Postgres lease/concurrency and R2 upload tests remain required with service credentials. |
| Hosted GenVM | Disposable StudioNet CharterV2, MemoryV2, MarketV2 deploys executed successfully and exact deployed source matched the then-current source. Later contract hardening requires fresh verification. Market schema/real embeddings and later probes hit the RPC hourly limit. See transaction hashes below. |
| Beta network | Bradbury RPC returns HTTP 403 from this host. Funded beta deployment, source/vision/model execution, native appeals/finality and finalized message/transfer checks remain blocked. |
| Hosting | Docker/Fly configuration and migration tooling provided. Docker is unavailable locally; Neon/R2/Privy/Fly credentials are absent. No public hosting cutover performed. |

Hosted smoke hashes (successful ACCEPTED execution, not an operational product deployment):

- Charter: `0xdbe266a7cc29348e59fcf1dcb9601acadfdc5e84b7b5cf5e203705ed3030d635`
- Memory: `0x6bb325fbab5ac30af5aa50f265d03fa5b125f3f91bf5f65702955639a9435a65`
- Market: `0xaa307c60a3b29acf4056af7a67e80e246684987ce23cb2afad39494041ffc779`

`npm run test:runtime` uses an ephemeral gasless StudioNet account, deploys disposable contracts, verifies execution/code/schema, and exercises real model ingestion/search. It records hashes/results under `/tmp/vantage-runtime-report.json`. Do not make these addresses the product deployment; run the verified deployment script with the operational owner after all gates pass.

Before beta release, run a funded end-to-end commitment, numeric and conditional market through compilation, reviewed activation, quotes/trading, actual source observations including vision, conflicting evidence, challenge/evidence appeal, native transaction appeal, finality, settlement, finalized precedent ingestion, separate user/LP claims and finalized withdrawal. Require conservation and replay after appeal, and prove that no backend verdict or relayer identity determines settlement.

## Known limits

- GLSim 0.29.2 replaces storage managers on failed leader rotation but existing contract objects retain old storage slots. The suite verifies disagreement and rotations; actual rollback must be proven in GenVM. No simulator workaround is presented as a network guarantee.
- Stable JS 1.1.8 exposes `canAppeal`, `getMinAppealBond`, `appealTransaction` and `finalizeTransaction`. It lacks protocol v0.6 distribution/charge APIs. Those fees are explicitly unsupported until the runner, CLI, SDK and tests migrate together.
- Source byte hashes deliberately require stable content agreement. Dynamic/volatile pages can fail consensus. Locked historical records and primary endpoints are preferred; screenshot content is not historical authenticity.
- Semantic case retrieval informs review and never rewrites a rule. Active duplicate blocking is canonical exact-spec matching, not semantic clustering of all active questions.
- The source budget reserves post-deadline slots and separates nominated sources. Public checkpoint submission can still consume bounded slots; monitor exhausted budgets and use immutable charter policies appropriate to deployment.
- Archive retention is for consensus JSON; original raw media is not retained. Author bonds refund on terminal resolution; there is no automatic subjective ambiguity slashing. Integer payout dust stays in contract collateral, with no owner sweep. These policies are explicit rather than hidden discretionary settlement powers.
