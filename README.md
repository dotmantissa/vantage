# Vantage

A prediction market built around resolution, settled by GenLayer Intelligent Contract consensus.

Most prediction markets are good at the easy half of the problem. Matching a buyer to a seller
is solved. Deciding what actually happened is not. That half is usually handed to a multisig, a
token vote, or a company, and the market's credibility is capped by whichever of those you are
willing to trust.

Vantage puts the resolution machinery on chain and makes it the primary object. A question is
compiled into a machine-checkable specification before a single share is minted. Evidence is
fetched from a whitelisted source set, cross-checked for quorum, and compared across validators.
The verdict is provisional first, contestable by anyone with a bond, and only then final. Every
settled market leaves behind a precedent that constrains how the next one is compiled.

---

## Table of contents

- [What is deployed](#what-is-deployed)
- [Repository layout](#repository-layout)
- [Architecture](#architecture)
- [The contracts](#the-contracts)
  - [VantageCharter](#vantagecharter)
  - [VantageMarket](#vantagemarket)
- [Market lifecycle](#market-lifecycle)
- [Spec compilation](#spec-compilation)
- [The resolvability gate](#the-resolvability-gate)
- [Resolution](#resolution)
- [Contest: challenge and appeal](#contest-challenge-and-appeal)
- [The AMM](#the-amm)
- [Fees, bonds, and the court fund](#fees-bonds-and-the-court-fund)
- [Backend](#backend)
- [HTTP API](#http-api)
- [Frontend](#frontend)
- [Getting started](#getting-started)
- [Testing](#testing)
- [Deployment](#deployment)
- [Design system](#design-system)
- [Known gaps](#known-gaps)

---

## What is deployed

| | |
|---|---|
| Network | GenLayer StudioNet |
| Chain ID | `61999` |
| RPC | `https://studio.genlayer.com/api` |
| `VantageCharter` | `0xBfB34B0b1dCa954823fBbefBAc815c4136d815e0` |
| `VantageMarket` | `0xe143684F1f1fC777d79401C7C26b2123A1c51fe1` |
| Deployer | `0xBC1399c55538eC034d4Da550C03c34Ae0C357f53` |
| Deployed | 2026-10-01 |

Live addresses are read from `deployed_contracts.json` at runtime by both the backend indexer and
the deploy script; the values above are the fallbacks hardcoded in `backend/src/indexer.js` and
`frontend/src/lib/contracts.js`.

---

## Repository layout

```
contracts/
  vantage_charter.py     Immutable versioned rulebook + precedent registry (deterministic)
  vantage_market.py      Compilation, AMM, resolution, contest, settlement (non-deterministic)
deploy/
  deploy.mjs             Deploys both contracts, authorizes the market as a registrar
  seed_market.mjs        Compiles a sample market against the live deployment
backend/src/
  server.js              Local Express entrypoint, boots DB + continuous sync
  app.js                 Express app (also imported by the serverless handler)
  db.js                  Neon PostgreSQL schema and migrations
  indexer.js             Pulls on-chain state into Postgres
  auth.js                Privy token verification middleware
  routes/api.js          REST surface, relayer, validation preflight
api/
  index.js               Vercel serverless adapter around the Express app
frontend/src/
  App.jsx                View switch, theme persistence
  components/            Header, CompiledSpecSheet
  pages/                 Markets, MarketDetail, CreateMarket, Precedents, Charter
  lib/contracts.js       GenLayer read client, wei helpers, address book
  styles/tokens.css      Design tokens
tests/direct/            Direct-mode pytest suites for both contracts
DESIGN_TOKENS.md         The design system, written down before the CSS
```

---

## Architecture

```
  Browser (Vite SPA, Privy email auth)
        │
        │  REST
        ▼
  Express API  ──────────────┬──────────────┐
        │                    │              │
        │ read/index         │ relay        │ preflight
        ▼                    ▼              ▼
  Neon PostgreSQL     genlayer-js      local heuristics
   (read cache)        writeContract    (no chain cost)
                            │
                            ▼
              ┌─────────────────────────────┐
              │   GenLayer StudioNet        │
              │                             │
              │   VantageMarket ──reads──▶  │
              │        │              Charter│
              │        │                     │
              │   gl.nondet.web.get          │
              │   gl.nondet.exec_prompt      │
              └─────────────────────────────┘
```

Postgres is a read cache, never a source of truth. Every number the UI shows about a market can be
re-derived from the chain; the database exists so a market list does not cost fifteen RPC round
trips. Writes go through the relayer, which broadcasts with the deployer key — users authenticate
with Privy email and never hold gas.

---

## The contracts

Both contracts target `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6`.

### VantageCharter

The deterministic half. No LLM calls, no web access, nothing that could differ between validators.
It holds two things.

**Immutable versioned charters.** A charter is the house rulebook: the ranked source whitelist, the
timezone, tie handling, quorum defaults, the ambiguity policy, the challenge and appeal windows, the
grace period, numeric tolerance, and the open-interest threshold above which resolution must run
twice. Publishing a version under a label that already exists is rejected — `v1` means the same
thing forever. `set_active_version` points new markets at a different published version; markets
already compiled keep resolving under the version they were compiled against, because the market
body stores its `charter_version` and `resolve()` reads that specific one back.

Deployment defaults for `v1`:

| Field | Value |
|---|---|
| `ranked_sources` | `api.github.com`, `api.coingecko.com`, `www.federalreserve.gov`, `api.weather.gov`, `en.wikipedia.org` |
| `timezone` | `UTC` |
| `tie_handling` | `VOID` |
| `default_quorum_k` / `default_quorum_n` | 2 of 3 |
| `ambiguity_policy` | `VOID_AND_SLASH_AUTHOR` |
| `challenge_window_seconds` | 86400 |
| `appeal_window_seconds` | 86400 |
| `grace_period_seconds` | 604800 |
| `numeric_tolerance_bps` | 50 |
| `dual_run_threshold_wei` | 50 GEN |

Tie handling is constrained to `VOID`, `LOWEST_OUTCOME_INDEX`, or `HIGHEST_RANKED_SOURCE`. The
ambiguity policy is constrained to `VOID_AND_SLASH_AUTHOR`, `VOID_AND_REFUND_BOND`, or
`DEFER_TO_PRECEDENT`. Anything else is rejected at publish time rather than discovered at
resolution time.

**A precedent registry.** Settled rulings are recorded as tag-indexed "Vantages": a spec pattern,
the outcome it produced, and the reason code. `lookup_for_spec(tags_csv, limit)` ranks matches by
tag overlap, then recency, then id — a total order, so every validator calling it receives
byte-identical output; `lookup_by_tag(tag)` reads a single tag's bucket. Only authorized registrars
can write precedent; `deploy.mjs` authorizes the market contract as part of deployment, and
`settle()` calls `record_precedent` as part of settling, so case law accumulates on its own.

Public surface: `publish_charter`, `set_active_version`, `get_active_charter`, `get_charter`,
`get_active_version`, `list_charter_versions`, `get_source_rank`, `authorize_registrar`,
`revoke_registrar`, `is_registrar`, `list_registrars`, `record_precedent`, `get_precedent`,
`lookup_by_tag`, `lookup_for_spec`, `get_precedents_for_market`, `list_tags`, `get_registry_stats`.

### VantageMarket

The non-deterministic half, and the bulk of the system. It owns compilation, the AMM, resolution,
the contest flow, settlement, and the internal credit ledger.

Storage is JSON-encoded documents in `TreeMap[str, str]` rather than a slot per field. A market body
has thirty-odd fields including nested lists; keeping it as one canonical JSON string means one slot
per market, identical bytes across validators, and the frontend reading a whole market in a single
call. Everything written through `_canonical()` is serialized with `sort_keys=True`, so two
validators producing the same logical state produce the same bytes.

Reserves, collateral, minted supply, positions, LP shares, participation indexes, credit balances,
and the authorized relayer set all live here. Positions and LP shares are keyed
`"<market_id>:<address>"`.

Every value-bearing write — `compile_market`, `buy`, `sell`, `add_liquidity`, `remove_liquidity`,
`challenge`, `appeal`, `resolve`, `withdraw` — takes an optional trailing `actor`. Leaving it off
makes the caller their own actor, which is what a directly signed transaction does. Supplying it is
how the gasless relayer names the authenticated user it is acting for; only the owner or an address
registered through `set_relayer` may name anyone but itself. Three read-only views exist to make the
machinery inspectable from outside: `get_book` (reserves, held shares, collateral, minted, and the
one-wei redemption rate), `get_resolution_plan` (the endpoints and distinct hosts each pass will
consult), and `get_precedent_payload` (the precedent arguments settlement will write back).

---

## Market lifecycle

```
                       compile_market()
                              │
                   ┌──────────┴──────────┐
              gate fails              gate passes
                   │                      │
            bond refunded,               OPEN ──── buy / sell / add_liquidity
            nothing minted                │
                                    close_market()
                                          │
                                        CLOSED
                                          │
                                      resolve()          ← keeper-callable, earns bounty
                                          │
                       ┌──────────────────┼──────────────────┐
                  quorum met        quorum failed      dual-run disagreement
                       │                  │                  │
                  PROVISIONAL            VOID               VOID
                       │
        ┌──────────────┼──────────────┐
   challenge()      appeal()      (windows lapse)
        │              │               │
   CHALLENGED      APPEALED         finalize()
        │              │               │
 resolve_challenge  resolve_appeal    FINAL
        │              │               │
        └──────────────┴──────────────►│
                                       │
                                   settle()
                                       │
                                    SETTLED
```

States: `OPEN`, `CLOSED`, `PROVISIONAL`, `CHALLENGED`, `APPEALED`, `FINAL`, `SETTLED`, `VOID`.

`void_expired()` is the escape hatch. If a market is neither settled nor void once its grace
deadline passes (close time plus the charter's grace period, one week by default), anyone can void
it. With no winner, every share is worth its share of a complete set — one wei split across the
outcome count — so holders are refunded on the shares they hold and liquidity providers on the
shares still in the pool. A market that nobody ever resolves cannot trap funds indefinitely, and it
cannot strand the pool's half of them either.

Reason codes attached to every terminal state: `QUORUM_MET`, `QUORUM_FAILED`, `SOURCE_CONFLICT`,
`SOURCE_UNAVAILABLE`, `PREDICATE_AMBIGUOUS`, `CHALLENGE_UPHELD`, `CHALLENGE_REJECTED`,
`APPEAL_UPHELD`, `APPEAL_REJECTED`, `DUAL_RUN_DISAGREEMENT`, `GRACE_PERIOD_VOID`,
`CONDITION_UNMET`.

---

## Spec compilation

An author writes a plain English question and posts a bond. `compile_market()` turns it into a
locked specification with an LLM, inside `gl.vm.run_nondet_unsafe`.

The prompt is assembled from the active charter (house rules, timezone, tie handling, quorum,
ambiguity policy), the allowed domain list, and up to five relevant prior rulings pulled from the
charter's precedent registry using a cheap deterministic tag guess. The author's question is wrapped
in `<<<QUESTION_BEGIN>>>` / `<<<QUESTION_END>>>` markers under an injection guard that tells the
model the enclosed text is a subject, not an instruction.

The model returns JSON with a fixed key set: `restated_question`, `outcomes`, `predicate_type`,
`predicate`, `predicate_field`, `comparator`, `threshold`, `units`, `sanity_min`, `sanity_max`,
`fact_schema`, `sources`, `tags`, `criteria`, `resolvable`, `issues`, `suggested_rewrites`.

`sources` are request URLs, not bare domains. The prompt asks for the full path and query string
needed to read the fact — `api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd`
rather than `api.coingecko.com` — because the parameters *are* the fact. The host must be on the
charter whitelist and no two sources may share a host; `_normalize_endpoint()` lowercases the host,
preserves the request verbatim, and rejects outright anything that could point the fetch elsewhere
(embedded credentials, an explicit port, a second scheme, whitespace, non-printable bytes).

**Validators compare every material field, each on the dimension that can change a verdict.**
`_spec_fingerprint()` drops only the restated question and the rationale. The locked `spec_hash`
commits to everything else, including the exact endpoints. `_specs_equivalent()` then requires:

| Field | Compared on |
|---|---|
| outcome set, predicate type, comparator, threshold | exactly — the enums and the one number the comparator is applied to |
| quorum parameters, charter version | exactly |
| `units` | principal measurement: `USD` ≡ `USD per ETH`, `USD` ≠ `GBP` |
| `predicate_field` | content words, because the field name is a label the compiler invents: `price_usd` ≡ `eth_usd_price`, `price_usd` ≠ `volume_usd` |
| `fact_schema` | the predicate field must be declared on both sides with the same coarse type (`number` ≡ `float`), and any field both sides declare must agree on type. A surplus context field on one side is not a disagreement about the verdict |
| `sanity_min` / `sanity_max` | both guards must admit the threshold and overlap each other, rather than match to the digit |
| `predicate`, `criteria` | content containment: most of the shorter statement's words must appear in the longer one |
| sources | the same host count on both sides, and at least `quorum_k` hosts in common — the number that has to agree for a verdict. Two validators each naming three reputable price APIs out of six whitelisted ones should not fail over which third one they picked; two naming disjoint sets still do |
| `close_time` | within 900 seconds, because two validators reading "end of Friday" may land a few minutes apart |

Each row is a judgement about what a verdict can turn on, and the calibration is
load-bearing in both directions. Compare too loosely and a leader decides alone; compare a
model-invented variable name byte for byte and a question that two validators understand
identically fails consensus over spelling. The live compile that produced the deployed
market agreed in one round; an earlier pass that compared field names and full URLs exactly
rotated through four leaders and never agreed, on the same question.

Request *paths* are deliberately not compared across validators: two of them may reach the same
figure through differently parameterized endpoints, and failing consensus over a query string would
be failing over nothing. What protects the fetch instead is that every validator re-validates the
leader's endpoints through the resolvability gate, and that the endpoints are locked into the spec
hash — so the resolution pass fetches identical bytes on every node.

Two validators phrasing the same predicate differently is fine. Two validators disagreeing about the
outcome set, the deadline, the unit, the extraction schema, the sanity band, or the source hosts is
not.

If both the leader and the validator conclude the question is unresolvable, they agree — that is a
valid consensus on "no". Disagreement about *whether* it is resolvable fails the comparison.

---

## The resolvability gate

The gate runs in plain Python over the structured spec, on every validator, after the model has done
its part. This is the load-bearing safety property: the gate cannot be argued out of by a persuasive
model, because it never sees prose.

It rejects a market when:

- fewer than 2 or more than 8 outcomes;
- two outcomes normalize to the same string, so they are not mutually exclusive;
- an outcome label is empty;
- a source that is not a usable request URL, or whose host is not on the charter whitelist;
- fewer independent source *hosts* than the quorum requires, meaning the market could never settle;
- two sources sharing a host, which would fake a quorum out of one place;
- the same source listed twice;
- an unknown predicate type;
- an empty predicate;
- an empty `fact_schema` on a numeric or event claim, so there is nothing to extract;
- a numeric predicate missing its field, comparator, threshold, or units — because `5` could mean
  five dollars and five percent at once;
- a numeric threshold that does not parse as a number (or, for `in`, as a list of numbers);
- a numeric predicate whose `fact_schema` does not declare `predicate_field`;
- a numeric predicate whose outcome set is not a two-way yes/no pair, since the comparator has to be
  able to decide between them;
- a malformed or inverted sanity band;
- a subjective predicate with no written criteria, which would make it a vibe rather than a test;
- the model flagged it unresolvable and supplied issues.

When the gate returns problems, **the market is not created at all**. Nothing is minted, nothing is
charged, and the full attached value — bond and seed liquidity — is credited straight back to the
author, along with the specific problems and the model's suggested rewrites. A bounced question
costs its author time and nothing else.

---

## Resolution

`resolve()` requires the market to be `CLOSED`. Both the leader and validator run the same
`leader_fn`, which fetches the locked endpoints — one per host, up to `quorum_n` — and counts votes.

Resolution, challenge, and appeal all go through one extractor, `_extract_fact`, so a contest cannot
be held to a softer evidence standard than the verdict it is contesting.

**Source fetching is whitelisted twice.** A host must be in the charter's ranked source list (plus
any extras the author supplied at compile time, which were themselves recorded into the spec's
`allowed_sources`). `_extract_fact` re-normalizes the endpoint and re-checks its host against that
list at fetch time, and refuses anything outside it before a request is made. The request path and
query string are fetched as locked, so the evidence is the specific reading the spec names rather
than whatever the host happens to serve at its root.

**Fetched content is delimited and distrusted.** The response body is wrapped in
`<<<UNTRUSTED_SOURCE_CONTENT_BEGIN>>>` / `<<<UNTRUSTED_SOURCE_CONTENT_END>>>` and preceded by an
injection guard which states that the block is data, that the model is not permitted to decide the
market outcome, and that nothing inside the block can grant it that permission. Its only job is to
copy observable facts into the spec's `fact_schema`, and to report `found: false` rather than infer
when a fact is absent.

**Three further defences sit behind the guard:**

1. *Spec-hash echo.* The extraction must echo back the spec hash it was given. A response that
   drifted off task fails mechanically.
2. *Sanity bands.* For numeric predicates the compiled spec carries `sanity_min` and `sanity_max`.
   A value outside the physically plausible band is discarded rather than voted.
3. *Python-side transition.* The model never returns a state change, and for a numeric claim it
   never names the winner either. It reads a number; `_numeric_outcome_index()` then applies the
   comparator and threshold that were locked into the spec hash at compile time and derives the
   index itself. Any `outcome_index` the model volunteers for a numeric claim is discarded. A page
   that announces a result cannot be one, and a value that drifts across the threshold is a
   disagreement even when both validators read it inside the tolerance band.

**Quorum counts hosts, not fetches.** Votes are keyed by source host, so a host answering more than
once is still one vote and a duplicated source list cannot manufacture a quorum. An outcome wins by
reaching `quorum_k` distinct hosts. No outcome reaching it means `QUORUM_FAILED`; two outcomes both
reaching it means the sources genuinely conflict and the market voids with `SOURCE_CONFLICT` rather
than on a tiebreak. Either way the market voids and collateral comes back.

**Equivalence is tiered by predicate type.** `_findings_agree` walks the two passes endpoint by
endpoint — same host, same URL, same found/not-found — and `_values_agree` then compares the
readings according to what kind of claim is being settled: numeric values agree within the charter's
basis-point tolerance; event values agree on normalized JSON; subjective values agree on a bounded
enum. A price feed and a yes/no news event should not be held to the same notion of "same". The vote
tally and the failure reason have to match too, so two validators cannot agree on a winner while
disagreeing about which sources produced it.

**Dual run.** When a market's open interest is at or above the charter's `dual_run_threshold_wei`
(50 GEN by default), one successful resolution is not enough. The first run records its winner and
leaves the market `CLOSED`; a second `resolve()` must reach the same winner. Disagreement voids the
market with `DUAL_RUN_DISAGREEMENT`. High stakes buy a second opinion.

On success the market becomes `PROVISIONAL`, the challenge deadline is set to now plus the charter's
challenge window, and the appeal deadline to now plus challenge window plus appeal window — the
appeal window runs *after* the challenge window closes. The caller receives a keeper bounty paid out
of the court fund, capped at whatever the fund actually holds, which is what makes resolution
permissionlessly callable.

---

## Contest: challenge and appeal

A provisional verdict is not a verdict yet.

**`challenge(market_id, evidence_url)`** requires a bond and a URL, and the URL is held to the same
source policy as the evidence that produced the verdict. It must be a well-formed request URL on a
host the charter authorized for this market, checked at submission *before* the bond is locked
rather than quietly ignored during the rerun; the path and parameters are preserved into the contest
document. `resolve_challenge()` then re-runs the one extractor with the challenger's endpoint folded
into the locked set — replacing that host's endpoint if it names a host already in the set, so
contrary evidence widens the sample without voting twice — and returns `CHALLENGE_UPHELD` or
`CHALLENGE_REJECTED`.

**`appeal(market_id)`** requires a larger bond and escalates to `APPEALED`, incrementing the
market's appeal round counter. `resolve_appeal()` reaches for sources the first pass did not use: it
starts from the locked endpoints, adds whitelisted hosts that were unused, and keeps one endpoint
per host, up to `quorum_n * 2`. Every entry is a distinct host, so doubling the sample doubles the
evidence instead of double-counting it, and the contract refuses to run an appeal whose source set
is not one endpoint per host. `get_resolution_plan(market_id)` publishes both passes so the source
set can be inspected before anything resolves.

**`finalize(market_id)`** moves a provisional market to `FINAL` once the appeal deadline has passed
with nothing pending.

**`settle(market_id)`** requires `FINAL`. **One winning share redeems for exactly one wei** — the
other half of the minting rule, which is what makes the book conserve: one wei of collateral mints
one complete set, and redeeming the winning side of every set returns exactly the collateral that
was put in. Holders are credited their winning share count; the pool's winning shares belong to the
liquidity providers and are split pro rata by LP share. The two together can never exceed the
collateral the market holds, and `settle()` checks that in contract code rather than assuming it.
The author's bond is released if it was still held. Settlement is pull-based at the edge: credits
accumulate in the contract's internal `balances` ledger and `withdraw()` transfers them to their
owner, so one bad address cannot block everyone else's payout.

Settling also writes the ruling back to the charter. `_record_precedent()` builds the registry's
argument set — a spec pattern carrying the locked comparator, normalized tags, a reason code from
the enum, the pinned charter version — validates it against the same rules the registry enforces,
and emits `record_precedent` on `accepted`. It is not wrapped in a swallowed `except`: a settlement
either records a precedent the charter will accept or it reverts. `get_precedent_payload(market_id)`
exposes exactly what will be written.

---

## The AMM

A Gnosis-style constant-product market maker over N outcome reserves, implemented entirely in
integers. No `exp`, no `ln`, no floats — floating point is a consensus hazard, and every validator
has to land on the same wei.

One wei of collateral mints one share of every outcome. One winning share redeems for one wei. Those
two sentences are the same rule read in both directions, and they are what make the book conserve:
for every outcome, `reserve + shares held outside the pool == minted`, and `collateral == minted`.
`get_book(market_id)` publishes all of it so the identity can be checked from outside, and the
direct-mode suite asserts it through buys, sells, and settlement.

**Buying** adds collateral, which mints a complete set. The buyer keeps the shares of their chosen
outcome and the rest go into the pool; they then take out whatever keeps the product at or above its
previous value. Ceiling division on the new reserve means the trader receives slightly less than the
exact real-valued answer, so rounding always favours the pool and the invariant never erodes.

**Selling** is the mirror: push shares in, pull complete sets out, burn them back to collateral. The
collateral returned is the largest `c` satisfying

```
∏(j ≠ index) (r_j − c)  ×  (r_index + shares_in − c)  ≥  k
```

The left side falls monotonically in `c`, so a binary search over integer bounds finds it. Monotone
plus bounded means every validator walks the identical path to the identical answer, in at most 256
iterations.

**Prices** are marginal, in basis points: outcome `i` is weighted by the product of every other
reserve, normalized so the set sums to exactly 10000. The last entry absorbs the rounding remainder,
so the frontend never has to apologise for a total of 99.99 percent.

Both `buy` and `sell` take a slippage bound (`min_shares_out`, `min_collateral_out`) and revert
rather than fill through it. Trades are rejected outright if they would drain an outcome reserve to
zero.

---

## Fees, bonds, and the court fund

Fees are charged on the gross collateral of every buy, in basis points out of 10000:

| Split | Default | Destination |
|---|---|---|
| Total | 200 (2%) | — |
| LP | 120 | Added to every reserve, so LPs earn without a separate claim |
| Creator | 40 | Credited to the market author |
| Court | 40 | Court fund, which pays keeper bounties |

The constructor validates that the three components sum to the total and that the total does not
exceed 10%.

Bonds (contract defaults, in atto GEN):

| Bond | Default | Purpose |
|---|---|---|
| Author | 5 GEN | Skin in the game for writing a clear question. Slashed to the court fund if the market voids for ambiguity and the charter policy says so; released at settlement otherwise. |
| Challenge | 10 GEN | Posted to contest a provisional verdict. |
| Appeal | 25 GEN | Posted to escalate. Deliberately the most expensive path. |
| Keeper bounty | 0.5 GEN | Paid from the court fund to whoever calls `resolve()`. |

`fund_court()` is payable and open to anyone — the court fund can be topped up by the owner, by a
sponsor, or by fee flow.

---

## Backend

Node 18+, ESM throughout. Express + Neon serverless PostgreSQL + Privy + `genlayer-js`.

**`db.js`** owns the schema and runs `CREATE TABLE IF NOT EXISTS` on boot: `markets`, `precedents`,
`trades`, `users`, `contests`, `positions`, with GIN indexes on the `tags` arrays of `markets` and
`precedents` and btree indexes on trade and position lookups.

**`indexer.js`** creates a read-only `genlayer-js` client against StudioNet, resolves contract
addresses from `deployed_contracts.json` (falling back to the hardcoded pair), and syncs on-chain
market state into Postgres. Precedents are indexed by asking the charter which tags it actually holds
(`list_tags`) and then reading each one with `lookup_by_tag(tag)` — a single argument, which is the
method's declared signature. `server.js` starts a continuous sync on a 180-second interval; the
serverless deployment triggers it through `POST /api/sync` instead, since a Vercel function has no
long-lived process to run a timer in.

**`auth.js`** verifies Privy tokens via `@privy-io/server-auth`, extracting the user's embedded
wallet address and email. It exports `requireAuth` (401 on failure) and `optionalAuth` (attaches
`req.user` if present, never blocks). With no Privy credentials configured it falls back to a demo
user so local development works without secrets — this is permissive by design and must not be
relied on in production.

**The relayer** (`POST /api/relay`) is how users transact without gas, and it requires
authentication. The backend holds `DEPLOYER_KEY` and pays for the transaction, but the *on-chain
principal* is the Privy-verified wallet of the signed-in user: the handler reads it from the bearer
token, appends it as the trailing `actor` argument, and ignores anything the request body claims
about who is calling. `VantageMarket._actor()` accepts a named actor only from the owner or an
address registered through `set_relayer`, so authorship, positions, bonds, and credits are all
recorded against the user rather than against the relayer's key — and a relayed `withdraw` pays out
to the user's address, not the one that paid the gas. Because GenLayer consensus can outlast a
serverless function's budget, the relayer is asynchronous: it returns a transaction hash immediately
and the client polls
`GET /api/relay/status/:txHash`, which maps StudioNet transaction status codes to `PENDING`,
`ACCEPTED`, or `FAILED` and decodes the base64 consensus payload back into the contract's JSON
return value. After a confirmed `buy`, `sell`, `add_liquidity`, or `remove_liquidity`, the relayer
writes the corresponding row into `trades` and refreshes the trader's `positions`.

**`POST /api/validate-market`** is a preflight that runs entirely off chain. Local heuristics assess
resolvability, recommend sources from the whitelist, parse a timeline out of the question text
(ISO and Day-Month-Year forms), guess whether the predicate is numeric, and derive tags. It costs
nothing and catches the obvious failures before an author pays a bond to be told the same thing by
the chain.

---

## HTTP API

Mounted at both `/api/*` and `/*`, so the serverless rewrite and the local dev proxy can share one
router.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/health` | Liveness plus DB reachability |
| `GET` | `/markets` | Market list, filterable |
| `GET` | `/markets/:id` | Single market with spec and prices |
| `GET` | `/markets/:id/position/:address` | A holder's shares and LP position |
| `GET` | `/markets/:id/trades` | Trade history |
| `POST` | `/trades` | Record a trade (`optionalAuth`) |
| `GET` | `/charter` | Active charter body |
| `GET` | `/precedents` | Precedent registry, tag-filterable |
| `POST` | `/validate-market` | Off-chain resolvability preflight |
| `GET` | `/stats` | On-chain stats merged with indexed aggregates |
| `POST` | `/relay` | Broadcast a contract write via the relayer (`requireAuth`; the verified wallet becomes the on-chain actor) |
| `GET` | `/relay/status/:txHash` | Poll consensus status, decode the return value |
| `POST` | `/sync` | Trigger an indexer pass |
| `GET` | `/users/profile` | Authenticated profile (`requireAuth`) |

---

## Frontend

Vite + React 18, no router — `App.jsx` switches between five views and persists theme choice to
`localStorage`. Privy handles email-only auth; `genlayer-js` is available client-side for direct
reads, and `ethers` for wei arithmetic.

- **MarketsPage** — the market list.
- **MarketDetailPage** — prices, the trade panel, position, activity, and the contest controls.
- **CreateMarketPage** — a two-stage flow. The question is validated off chain first, the author
  sees recommended sources and a detected timeline, and only then does compilation go on chain. If
  the chain's resolvability gate rejects it, the validator's specific problems and suggested
  rewrites are surfaced rather than a generic failure, and the author is not redirected away.
- **PrecedentsPage** — the precedent registry, browsable by tag.
- **CharterPage** — the active charter, rendered as the rulebook it is.
- **CompiledSpecSheet** — the recurring document object: plain English on the left, a vertical
  hairline with a seal at its midpoint, the compiled machine-checkable predicate on the right. It is
  the market card, the detail header, and the receipt.

---

## Getting started

### Prerequisites

- **Python 3.12 or newer.** The GenLayer SDK uses PEP 695 generics (`class Lazy[T]`), which 3.10
  cannot parse. A system `python3` older than 3.12 will not work.
- **Node 18+**
- A Neon PostgreSQL database
- A Privy app (email login)
- A funded StudioNet key for deployment and relaying

### Install

```bash
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt

npm install
npm --prefix frontend install
```

### Configure

```bash
cp .env.example .env
```

```bash
GENLAYER_RPC_URL=https://studio.genlayer.com/api
GENLAYER_CHAIN_ID=61999
DEPLOYER_KEY=0x_your_32_byte_hex_private_key

DATABASE_URL=postgresql://user:password@host.neon.tech/db?sslmode=require&channel_binding=require

PRIVY_APP_ID=your_privy_app_id
PRIVY_APP_SECRET=your_privy_app_secret
VITE_PRIVY_APP_ID=your_privy_app_id

PORT=3001
VITE_API_URL=http://localhost:3001
```

Vite reads from the repository root (`envDir: '../'`), so there is one `.env` rather than two.

### Run

```bash
npm run dev          # backend on :3001 and frontend on :5173, concurrently
npm run dev:backend
npm run dev:frontend
```

The dev server proxies `/api` to `localhost:3001`, so the frontend uses relative paths in both
development and production.

### Deploy the contracts

```bash
npm run deploy:contracts
```

`deploy/deploy.mjs` verifies or deploys `VantageCharter`, deploys `VantageMarket` pointed at it,
authorizes the market as a precedent registrar, and writes `deployed_contracts.json`. It waits on
`ACCEPTED` with a 3-second interval and up to 100 retries, because StudioNet consensus is not
instant.

```bash
node deploy/seed_market.mjs
```

compiles a sample market against the live deployment, which is the fastest end-to-end check that
compilation, the gate, and the AMM seeding all work.

---

## Testing

```bash
npm run lint:contracts   # genvm-lint on both contracts
npm run test:contracts   # pytest tests/direct -v
npm test                 # both of the above
```

`tests/direct` runs the contracts in direct mode with a mocked VM, so the LLM and web calls are
injected rather than live. 141 tests across two suites and one shared rules module:

- **`test_charter.py`** — deployment validation (bad quorum, bad tie handling, too-short grace, a
  single source), version immutability, active-version switching, owner gating, registrar
  authorization and revocation, precedent recording, duplicate rejection, tag lookup, and
  `lookup_for_spec` ranking. Plus the charter half of the settlement write back: that a payload of
  the shape `settle()` emits is accepted, stored, and served back by `lookup_by_tag(tag)` and
  `lookup_for_spec`, that every reason code a settlement can carry is recordable, that an
  unauthorized caller is refused, and that `lookup_by_tag` takes exactly one argument.
- **`test_market.py`** — fee-split validation, compilation of resolvable and unresolvable questions,
  consensus agreement and disagreement paths, buy/sell/position accounting, price normalization,
  liquidity add and remove, the full lifecycle through close, resolve, finalize, and settle, the
  challenge and appeal transitions and their bond requirements, grace-period voiding, every view
  method, and owner-only admin. Plus:
  - *settlement value* — one winning share redeems one wei; the winner is credited exactly its share
    count and the loser nothing; holder payout plus LP payout equals the collateral and never exceeds
    it; `reserve + held == minted` and `collateral == minted` through buys and sells; `withdraw()`
    emits a transfer of the full balance to its owner, zeroes the balance, and reverts on a second
    call; a void refunds traders and liquidity providers.
  - *precedent write back* — settlement emits exactly one `record_precedent` call, to the charter
    address, whose arguments equal `get_precedent_payload()` and satisfy the registry's own rules.
  - *evidence policy* — the locked endpoint's path and parameters are what get fetched (a market
    whose hosts answer only at their root cannot resolve); off-whitelist hosts never reach a spec;
    several paths on one host collapse to one source; a short source list is backfilled to the
    quorum; the spec hash moves when units or the fact schema move. The validator rejects a
    different unit, reading a different quantity, a conflicting declared type, a sanity band that
    excludes the threshold or is disjoint from the leader's, a disjoint source set, and a different
    predicate — while accepting a unit qualifier, a renamed field for the same reading, a surplus
    context field, an equivalent type name, a differently estimated band, one substituted source
    host, a different path on the same hosts, and a reworded or more verbose predicate.
  - *numeric derivation* — the contract overrules the model's `outcome_index` in both directions,
    treats the `gte` boundary as met, respects inverted outcome labels, discards a reading outside
    the sanity band or one that will not parse, and refuses to compile a numeric market with an
    unparseable threshold or a field missing from its schema.
  - *quorum independence* — the appeal set is distinct by host and reaches for hosts the first pass
    did not use; one host answering repeatedly cannot satisfy a quorum of two, while two hosts can.
  - *challenge evidence* — an off-whitelist host, a malformed URL, and credentials smuggled into the
    host are all refused at submission; the evidence path is preserved; contrary evidence is judged
    by the same extractor and overturns the verdict; evidence on a host already in the set cannot
    vote twice.
  - *relayed writes* — a relayed compile, buy, sell, challenge, appeal, bond refund, settlement
    payout, and withdrawal all land on the authenticated user rather than the relayer; a stranger
    cannot act for someone else; naming yourself always works; a malformed actor is refused;
    `set_relayer` is owner-only and revocable.
- **`precedent_rules.py`** — the charter's acceptance rules for `record_precedent`, written once and
  imported by both suites. Direct mode can only load one contract class per test, so the write back
  is proved from both ends against the same rules and neither half can drift.

`npm run test:integration` is wired to `gltest tests/integration --network studionet`, but
`tests/integration/` is currently empty — the script is scaffolding, not a passing suite.

---

## Deployment

`vercel.json` builds the SPA and mounts the Express app as a single serverless function:

```json
{
  "buildCommand": "npm --prefix frontend install && npm --prefix frontend run build",
  "outputDirectory": "frontend/dist",
  "functions": {
    "api/index.js": {
      "maxDuration": 60,
      "includeFiles": "{backend/**,deployed_contracts.json}"
    }
  },
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api/index.js" },
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

Three details matter:

- `includeFiles` must pull in `backend/**` and `deployed_contracts.json`, or the bundled function
  cannot resolve contract addresses at runtime.
- `maxDuration: 60` is the ceiling, which is why relaying is asynchronous rather than blocking on
  consensus.
- `api/index.js` forces IPv4 (`dns.setDefaultResultOrder('ipv4first')` plus an undici agent pinned
  to `family: 4`) before importing anything. Without it, outbound calls to Neon and StudioNet can
  hang on IPv6 resolution in the serverless runtime. The same preamble appears in `app.js`,
  `indexer.js`, and `deploy.mjs` for the same reason.

The function initializes the database lazily on first request and caches the result across warm
invocations.

Set `DATABASE_URL`, `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `VITE_PRIVY_APP_ID`, `GENLAYER_RPC_URL`, and
`DEPLOYER_KEY` as project environment variables. `.vercelignore` keeps contracts, tests, the venv,
and build artifacts out of the upload.

---

## Design system

`DESIGN_TOKENS.md` is the written record of the visual language, decided before any CSS was
written and implemented in `frontend/src/styles/tokens.css`.

Four source colours, no invented hues. Warm legal stock as the page ground, sage for live states,
forest for settled ones — both lifted one step in dark mode to clear WCAG AA. Every border is
exactly `1px solid var(--hairline)`; emphasis is a second rule, never a shadow, because documents do
not float. Market state is carried by rule weight and fill rather than alert colours: void is
hatched, challenged carries a double rule, final is filled forest.

Zilla Slab carries questions and headings in a documentary register. Archivo handles controls and
body text. JetBrains Mono is functional rather than decorative — the product literally renders
compiled predicates, fact schemas, and spec hashes, and they need to be read character by character.

Motion fires on action only. Nothing floats, pulses, or reveals on scroll. The entire motion budget
is spent in one place: when a question compiles, the machine column writes itself in character by
character, because that is the moment the product exists.

---

## Known gaps

Stated plainly rather than discovered later.

- **`tests/integration/` is empty.** The `gltest` script exists but there is nothing for it to run.
  Contract coverage is direct-mode only, which means consensus behaviour is simulated rather than
  exercised against real validators.
- **The relayer is custodial.** Users authenticate with Privy email and the backend broadcasts with
  `DEPLOYER_KEY`. That key is a single point of failure and pays for everything. On-chain state is
  now attributed to the authenticated user rather than to the key — authorship, positions, bonds, and
  credits all land on them, and a relayed withdrawal pays out to their address — but the key can
  still *choose* to act for any user it names, so the trust is reduced, not removed. It is the right
  trade for a StudioNet demo and the wrong one for mainnet.
- **Permissive auth fallback.** With no Privy credentials configured, `auth.js` returns a demo user
  rather than rejecting. Convenient locally, unacceptable in production — set the credentials.
- **Conditional markets are half-built.** `compile_market` accepts and validates
  `condition_market_id` and `condition_outcome`, and `CONDITION_UNMET` exists as a reason code, but
  nothing enforces the dependency at resolution time.
- **Indexing is poll-based.** A 180-second sync locally, and manually triggered in serverless.
  Between passes the database is stale; the frontend reads prices from the chain directly where
  freshness matters.
- **An appeal can only widen as far as the charter allows.** `resolve_appeal` reaches for whitelisted
  hosts the first pass did not use, and every entry is a distinct host, so duplicates cannot vote
  twice. But when the charter's ranked list is already exhausted there is nothing left to widen
  *to*, and the appeal re-reads the same hosts with a fresh validator set rather than a broader one.
  Widening further means publishing a charter with more sources.
- **Some material fields are bound semantically, not byte for byte.** Request paths are not compared
  across validators, nor are extraction field names, nor is the third source host out of three. Each
  is a case where two validators can describe the same reading differently, and comparing them
  exactly fails consensus over spelling rather than over substance — measured, not assumed: the same
  question that agrees in one round under the current rules rotated through four leaders and never
  agreed when field names and full URLs were compared exactly. What is locked into the spec hash is
  still the leader's exact choice among several a validator would have accepted, and the guarantee
  that the choice is *sound* comes from the resolvability gate re-running on every node rather than
  from the comparison.
