# V2 release evidence — 2026-10-21

Vantage V2 is live at https://vantage-genlayer.vercel.app on GenLayer StudioNet. This is a gasless test deployment, with accepted-state cross-contract reads explicitly disclosed. It is not a funded production-market release.

| Gate | Verified evidence |
| --- | --- |
| Contracts | Charter, Memory and grounded-evidence Market finalized successfully; exact source matches. Addresses and hashes: [V2_DEPLOYMENT.json](V2_DEPLOYMENT.json). |
| Business logic | 171 direct tests pass, covering protected quotes, conservation, independent claims, source provenance, JSON citations, disputes and conditional settlement. |
| Independent validators | Two five-validator controlled-input tests pass. Real hosted compilation and evidence extraction also achieved majority agreement. |
| Live frontend | Privy external-wallet login, reviewed exact-hash activation, buy, sell, LP add/remove, checkpoint, close, resolution, finalization, settlement, claim and withdrawal broadcast through the deployed UI. Different test deployments exercised trading and corrected evidence. Public hashes: [V2_LIVE_VALIDATION.json](V2_LIVE_VALIDATION.json). |
| Finalized messages | Corrected market settlement contributed m-1 to operational Memory after finality. Withdrawal finalized and emitted 1.001 GEN to the signing wallet. |
| API and services | Existing production Neon/Privy configured; protected keeper/cron secrets; Postgres consensus archive; bounded leased jobs. Actual five-minute user-systemd timer completed successful production invocations. GitHub manual invocation passed; scheduled Actions remain delayed. Daily Vercel cron remains a fallback. |
| Hosting | Requested Vercel alias serves V2 API/UI and retained V2 recovery pages. V1 remains at /legacy. |
| Browser and CI | Six desktop/mobile browser cases pass; lint, backend suite and Node22 build pass. Full CI [39637681783](https://github.com/dotmantissa/vantage/actions/runs/39637681783) for commit `5017ee0` passed. Latest local verification: 33 backend tests and six desktop/mobile cases pass, plus lint and Node22 build. |

## Gates still required for a funded beta

- Funded Bradbury end-to-end verification. The supplied account had zero GEN on Bradbury; StudioNet balances are simulated test collateral.
- Full vision-source and numeric/conditional market lifecycles, and native transaction appeal/recomputation. The hosted screenshot/model capability probe finalized with majority agreement; it does not establish a complete vision-market lifecycle.
- Separate live application challenge/evidence-appeal test. A 180-second-policy draft queued behind a stalled StudioNet evidence transaction; it was cancelled after its activation cutoff. The standard v2.1 charter was restored and finalized successfully. No application dispute broadcast occurred.
- StudioNet queue recovery: evidence transaction `0x8b9aea409e723907ed3da1d4491c17a2f5c735154857518435f1c86c18e9c8ea` remains COMMITTING, and the network refuses cancellation after processing starts. The keeper pauses new automated writes to that contract and continues tracking the saved hash. Health reports degraded while broadcasts remain unresolved. Obsolete job 19 was retired with its broadcast journal intact after old-market recovery completed.

## Runtime findings and limits

- StudioNet synchronous finalized cross-contract reads stalled until the leader timeout. StudioNet deployments set immutable finalized_reads=false; funded-network deployments default to true. Backend finality markers and finalized transfer/precedent messages remain.
- Free-form compilation comparisons and evidence facts caused validator disagreement. Compilation compares independently reviewed checks. JSON evidence uses independently verified source pointers; GitHub release IDs/timestamps come directly from the fetched record, avoiding LLM Unix arithmetic and citation formatting. No failed checkpoint applied state.
- StudioNet quotas observed here are 30 requests/minute and 500/hour. RPC reads are coalesced within each serverless instance; browser transaction hashes are retained and never automatically rebroadcast after an uncertain error.
- GLSim 0.29.2 failed-rotation storage rollback has a known defect; actual rejected live checkpoints were observed to leave the evidence list empty.
- Stable SDK 1.1.8 supports native appeal/finality methods but lacks protocol v0.6 fee-distribution APIs. Those fees remain explicitly unsupported.
- Archive retention covers consensus JSON, not original page/media bytes. Dynamic source hashes can disagree. Screenshots do not prove historical authenticity.
- Author bonds refund on terminal resolution. There is no discretionary ambiguity slashing or owner dust sweep. Void redemption is complete-set collateral accounting, not purchase-price insurance.
