# Vantage V2 architecture and compatibility

V2 retains V1 at /legacy. Fresh V2 deployments own separate state; no balances or historical markets are rewritten.

The browser signs every value-bearing action with the selected user's wallet. Contracts own draft approval, locked rules, observations, evidence judgments, AMM accounting, disputes, dependencies and individual claims. The API and worker index verified chain activity, preserve archives, and offer non-authoritative previews. They never supply an authoritative verdict.

CharterV2 stores immutable manifests/templates. MarketV2 coordinates state in one contract. MemoryV2 stores finalized precedents using pinned SentenceTransformer embeddings; similarity is retrieval, not authority. Every validator independently evaluates material fields. Money and outcome mapping are deterministic. Vision inputs are data, not proof of source authenticity.

Compatibility baseline: genlayer-js 1.1.8, CLI 0.39.2, genlayer-test 0.29.2, genlayer-py 0.16.3, genvm-linter 0.11.0. Runner and embeddings hashes live in shared/networks.json. All generated contracts pin them. Never use test/latest runtime aliases.

Local and StudioNet validation precede Bradbury. Bradbury is the beta target; an unavailable RPC or unfunded account blocks release, not development. Check the SDK chain definition rather than substituting an RPC into a different chain object. Native appeal capabilities and protocol fee estimation are discovered from the installed SDK and active network; unsupported actions stay unavailable with an explanation. No fixed committee-size claims.

Evidence uses a source manifest and publisher groups. AUTHORITATIVE accepts a designated primary record; QUORUM requires independently originating evidence. Failed requests are INSUFFICIENT, never negative facts. Checkpoints lock accepted content hashes and extracted facts; supplementary archives remain labeled. Historical observations require authenticated upstream timestamps/record identifiers under the locked policy.

Deployment is gated on actual GenVM text/vision/embedding and native-appeal integration checks. A generated manifest or passing direct suite is not proof of deployment or consensus. No hosting cutover is implicit in a repository push.

Probe results (2026-10-21): StudioNet chain identity verified via eth_chainId (61999). Bradbury RPC returned HTTP 403 / Cloudflare challenge from this host; public-testnet execution cannot yet be verified. Installed SDK exposes native appealTransaction, canAppeal and getMinAppealBond, but not v0.6 getAppealCharge/distribution estimation. V2 uses this stable API family; upgrading to v0.6 requires a coherent release migration, not mixing RC components.
