# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
"""
VantageCharter
==============

The rulebook and the case law of the Vantage court.

Vantage settles prediction markets by running an Intelligent Contract over live web
evidence. Two things have to live outside any single market for that to be fair:

1. The charter. House rules that every market inherits: how sources are ranked, which
   timezone a deadline is read in, what happens on a tie, the default k-of-n quorum, and
   the ambiguity policy. A charter version is immutable once published, and each market
   pins the version that was active when it was created. Rules therefore cannot change
   underneath open positions.

2. The precedent registry. When a market is challenged, appealed, or voided for
   ambiguity, the finalized ruling is written here as a Vantage: a spec pattern, a set of
   tags, the outcome, and a bounded reason code. The compiler reads relevant Vantages
   through a deterministic tag lookup before it locks a new spec, so the same edge case
   stops being an edge case the second time it shows up.

Consensus boundary
------------------
This contract is deliberately deterministic. It stores no web evidence and calls no
model. All of the non-deterministic work, the fetching and extraction and the validator
comparison, happens in VantageMarket. The charter is on-chain because it must be
tamper evident and version pinned, not because it needs validators to agree about the
outside world. Keeping the rulebook deterministic also means a market can read it
synchronously from inside a nondet block without dragging consensus into the lookup.

Write access to the registry is restricted to the owner plus explicitly authorized
registrar contracts, so a market can record its own precedent but nobody else can forge
case law.
"""

import json
import hashlib
import datetime as _dt
from datetime import timezone

from genlayer import *


ERROR_EXPECTED = "[EXPECTED]"

# How a market behaves when two allowed sources disagree and no k-of-n quorum forms.
TIE_HANDLING = ("VOID", "LOWEST_OUTCOME_INDEX", "HIGHEST_RANKED_SOURCE")

# What happens to the author bond when a market voids because its spec was ambiguous.
AMBIGUITY_POLICIES = ("VOID_AND_SLASH_AUTHOR", "VOID_AND_REFUND_BOND", "DEFER_TO_PRECEDENT")

# Claim types, which select the equivalence tier the resolver uses.
PREDICATE_TYPES = ("numeric", "event", "subjective")

# Bounded reason codes. Rulings never store free text as their machine readable reason.
REASON_CODES = (
    "QUORUM_MET",
    "QUORUM_FAILED",
    "SOURCE_CONFLICT",
    "SOURCE_UNAVAILABLE",
    "PREDICATE_AMBIGUOUS",
    "DEADLINE_BOUNDARY",
    "UNIT_MISMATCH",
    "SCOPE_UNDERSPECIFIED",
    "EVIDENCE_SUPERSEDED",
    "CHALLENGE_UPHELD",
    "CHALLENGE_REJECTED",
    "APPEAL_UPHELD",
    "APPEAL_REJECTED",
    "DUAL_RUN_DISAGREEMENT",
    "GRACE_PERIOD_VOID",
    "CONDITION_UNMET",
)

MAX_TAGS = 12
MAX_TAG_LEN = 48
MAX_PATTERN_LEN = 600
MAX_NOTE_LEN = 800
TAG_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789-_."


class VantageCharter(gl.Contract):
    owner: Address
    active_version: str
    charter_count: u256
    total_precedents: u256

    charters: TreeMap[str, str]
    charter_versions: DynArray[str]

    precedents: TreeMap[str, str]
    precedent_ids: DynArray[str]

    tag_index: TreeMap[str, str]
    tag_names: DynArray[str]

    registrars: TreeMap[str, str]
    registrar_list: DynArray[str]

    market_precedents: TreeMap[str, str]

    def __init__(
        self,
        ranked_sources_csv: str = "api.github.com,api.coingecko.com,www.federalreserve.gov,api.weather.gov,en.wikipedia.org",
        timezone_name: str = "UTC",
        tie_handling: str = "VOID",
        default_quorum_k: int = 2,
        default_quorum_n: int = 3,
        ambiguity_policy: str = "VOID_AND_SLASH_AUTHOR",
        challenge_window_seconds: int = 86400,
        appeal_window_seconds: int = 86400,
        grace_period_seconds: int = 604800,
        numeric_tolerance_bps: int = 50,
        dual_run_threshold_wei: str = "50000000000000000000",
    ):
        self.owner = gl.message.sender_address
        self.charter_count = u256(0)
        self.total_precedents = u256(0)
        self.active_version = ""

        self._publish(
            "v1",
            ranked_sources_csv,
            timezone_name,
            tie_handling,
            int(default_quorum_k),
            int(default_quorum_n),
            ambiguity_policy,
            int(challenge_window_seconds),
            int(appeal_window_seconds),
            int(grace_period_seconds),
            int(numeric_tolerance_bps),
            dual_run_threshold_wei,
        )

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _require(self, condition: bool, message: str) -> None:
        if not condition:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} {message}")

    def _now(self) -> u64:
        try:
            return u64(int(_dt.datetime.now(timezone.utc).timestamp()))
        except Exception:
            try:
                raw = getattr(gl, "message_raw", None) or getattr(gl.message, "raw", {})
                if isinstance(raw, dict) and "datetime" in raw:
                    stamp = str(raw["datetime"]).strip()
                    if stamp.endswith("Z"):
                        stamp = stamp[:-1] + "+00:00"
                    return u64(int(_dt.datetime.fromisoformat(stamp).timestamp()))
            except Exception:
                pass
            return u64(0)

    def _owner_only(self) -> None:
        self._require(
            gl.message.sender_address == self.owner,
            "Only the charter owner may perform this action",
        )

    def _caller_key(self) -> str:
        return str(gl.message.sender_address).lower()

    def _may_register(self) -> bool:
        if gl.message.sender_address == self.owner:
            return True
        return self._caller_key() in self.registrars

    def _canonical(self, payload: dict) -> str:
        return json.dumps(payload, sort_keys=True, separators=(",", ":"))

    def _digest(self, text: str) -> str:
        return "0x" + hashlib.sha256(text.encode("utf-8")).hexdigest()

    def _normalize_domain(self, raw: str) -> str:
        value = str(raw).strip().lower()
        for prefix in ("https://", "http://"):
            if value.startswith(prefix):
                value = value[len(prefix):]
        value = value.split("/")[0].split("?")[0].strip()
        if value.startswith("."):
            value = value[1:]
        return value

    def _parse_sources(self, csv_text: str) -> list:
        ordered = []
        for chunk in str(csv_text).split(","):
            domain = self._normalize_domain(chunk)
            if domain and domain not in ordered:
                ordered.append(domain)
        return ordered

    def _normalize_tag(self, raw: str) -> str:
        value = str(raw).strip().lower().replace(" ", "-")
        kept = "".join(ch for ch in value if ch in TAG_ALPHABET)
        while "--" in kept:
            kept = kept.replace("--", "-")
        return kept.strip("-._")[:MAX_TAG_LEN]

    def _parse_tags(self, csv_text: str) -> list:
        ordered = []
        for chunk in str(csv_text).split(","):
            tag = self._normalize_tag(chunk)
            if len(tag) >= 2 and tag not in ordered:
                ordered.append(tag)
        return ordered[:MAX_TAGS]

    def _read_tag_bucket(self, tag: str) -> list:
        stored = self.tag_index.get(tag, "")
        if not stored:
            return []
        try:
            parsed = json.loads(stored)
        except Exception:
            return []
        return parsed if isinstance(parsed, list) else []

    def _publish(
        self,
        version: str,
        ranked_sources_csv: str,
        timezone_name: str,
        tie_handling: str,
        default_quorum_k: int,
        default_quorum_n: int,
        ambiguity_policy: str,
        challenge_window_seconds: int,
        appeal_window_seconds: int,
        grace_period_seconds: int,
        numeric_tolerance_bps: int,
        dual_run_threshold_wei: str,
    ) -> str:
        label = str(version).strip()
        self._require(len(label) >= 2, "Charter version label is too short")
        self._require(label not in self.charters, f"Charter {label} already exists and is immutable")

        ranked = self._parse_sources(ranked_sources_csv)
        self._require(len(ranked) >= 2, "A charter needs at least two ranked sources")

        tie = str(tie_handling).strip().upper()
        self._require(tie in TIE_HANDLING, f"Unknown tie handling rule: {tie}")

        policy = str(ambiguity_policy).strip().upper()
        self._require(policy in AMBIGUITY_POLICIES, f"Unknown ambiguity policy: {policy}")

        quorum_k = int(default_quorum_k)
        quorum_n = int(default_quorum_n)
        self._require(quorum_n >= 2, "Quorum n must be at least two so sources can disagree")
        self._require(2 <= quorum_k <= quorum_n, "Quorum k must be between two and n")
        self._require(quorum_n <= len(ranked), "Quorum n cannot exceed the ranked source count")

        tolerance = int(numeric_tolerance_bps)
        self._require(0 <= tolerance <= 2000, "Numeric tolerance must sit between 0 and 2000 bps")

        challenge_window = int(challenge_window_seconds)
        appeal_window = int(appeal_window_seconds)
        grace = int(grace_period_seconds)
        self._require(challenge_window >= 600, "Challenge window must be at least ten minutes")
        self._require(appeal_window >= 600, "Appeal window must be at least ten minutes")
        self._require(
            grace >= challenge_window + appeal_window,
            "Grace period must outlast the challenge and appeal windows combined",
        )

        threshold = int(str(dual_run_threshold_wei).strip() or "0")
        self._require(threshold >= 0, "Dual run threshold cannot be negative")

        now = int(self._now())
        body = {
            "version": label,
            "ranked_sources": ranked,
            "timezone": str(timezone_name).strip() or "UTC",
            "tie_handling": tie,
            "default_quorum_k": quorum_k,
            "default_quorum_n": quorum_n,
            "ambiguity_policy": policy,
            "challenge_window_seconds": challenge_window,
            "appeal_window_seconds": appeal_window,
            "grace_period_seconds": grace,
            "numeric_tolerance_bps": tolerance,
            "dual_run_threshold_wei": str(threshold),
            "published_at": now,
            "published_by": str(gl.message.sender_address),
        }
        canonical = self._canonical(body)
        body["charter_hash"] = self._digest(canonical)

        self.charters[label] = self._canonical(body)
        self.charter_versions.append(label)
        self.charter_count = u256(int(self.charter_count) + 1)
        self.active_version = label
        return self.charters[label]

    # ------------------------------------------------------------------
    # Charter governance
    # ------------------------------------------------------------------

    @gl.public.write
    def publish_charter(
        self,
        version: str,
        ranked_sources_csv: str,
        timezone_name: str,
        tie_handling: str,
        default_quorum_k: int,
        default_quorum_n: int,
        ambiguity_policy: str,
        challenge_window_seconds: int,
        appeal_window_seconds: int,
        grace_period_seconds: int,
        numeric_tolerance_bps: int,
        dual_run_threshold_wei: str,
    ) -> str:
        """Publish a new immutable charter version and make it active."""
        self._owner_only()
        return self._publish(
            version,
            ranked_sources_csv,
            timezone_name,
            tie_handling,
            int(default_quorum_k),
            int(default_quorum_n),
            ambiguity_policy,
            int(challenge_window_seconds),
            int(appeal_window_seconds),
            int(grace_period_seconds),
            int(numeric_tolerance_bps),
            dual_run_threshold_wei,
        )

    @gl.public.write
    def set_active_version(self, version: str) -> str:
        """Point new markets at an already published charter version."""
        self._owner_only()
        label = str(version).strip()
        self._require(label in self.charters, f"Charter {label} has not been published")
        self.active_version = label
        return label

    @gl.public.view
    def get_active_charter(self) -> str:
        return self.charters.get(self.active_version, "")

    @gl.public.view
    def get_charter(self, version: str) -> str:
        return self.charters.get(str(version).strip(), "")

    @gl.public.view
    def get_active_version(self) -> str:
        return self.active_version

    @gl.public.view
    def list_charter_versions(self) -> str:
        return json.dumps(
            {
                "active": self.active_version,
                "versions": [str(v) for v in self.charter_versions],
                "count": int(self.charter_count),
            },
            sort_keys=True,
        )

    @gl.public.view
    def get_source_rank(self, version: str, domain: str) -> int:
        """Rank of a domain inside a charter. Lower wins. Returns -1 when not allowed."""
        stored = self.charters.get(str(version).strip(), "")
        if not stored:
            return -1
        try:
            body = json.loads(stored)
        except Exception:
            return -1
        ranked = body.get("ranked_sources", [])
        needle = self._normalize_domain(domain)
        for index, entry in enumerate(ranked):
            if str(entry) == needle:
                return index
        return -1

    # ------------------------------------------------------------------
    # Registrar management
    # ------------------------------------------------------------------

    @gl.public.write
    def authorize_registrar(self, registrar: str) -> str:
        """Let a market contract write precedent into the registry."""
        self._owner_only()
        key = str(registrar).strip().lower()
        self._require(len(key) == 42 and key.startswith("0x"), "Registrar must be a 20 byte address")
        if key not in self.registrars:
            self.registrars[key] = str(int(self._now()))
            self.registrar_list.append(key)
        return key

    @gl.public.write
    def revoke_registrar(self, registrar: str) -> str:
        self._owner_only()
        key = str(registrar).strip().lower()
        self._require(key in self.registrars, "That address is not a registrar")
        del self.registrars[key]
        return key

    @gl.public.view
    def is_registrar(self, registrar: str) -> bool:
        return str(registrar).strip().lower() in self.registrars

    @gl.public.view
    def list_registrars(self) -> str:
        active = [str(a) for a in self.registrar_list if str(a) in self.registrars]
        return json.dumps({"registrars": active, "count": len(active)}, sort_keys=True)

    # ------------------------------------------------------------------
    # Precedent registry
    # ------------------------------------------------------------------

    @gl.public.write
    def record_precedent(
        self,
        precedent_id: str,
        market_id: str,
        spec_pattern: str,
        tags_csv: str,
        outcome: str,
        reason_code: str,
        predicate_type: str,
        charter_version: str,
        ruling_note: str = "",
    ) -> str:
        """
        Write a finalized ruling into the registry as a Vantage.

        Only the owner or an authorized market contract may call this, and only once per
        precedent id. The stored record is what the compiler later reads when it sees a
        similar question, so everything in it is bounded: the reason is an enum, the
        predicate type is an enum, and the tags are normalized.
        """
        self._require(self._may_register(), "Caller is not authorized to record precedent")

        pid = str(precedent_id).strip()
        self._require(len(pid) >= 3, "Precedent id is too short")
        self._require(pid not in self.precedents, f"Precedent {pid} already recorded")

        market = str(market_id).strip()
        self._require(len(market) >= 1, "Precedent must reference a market")

        pattern = str(spec_pattern).strip()[:MAX_PATTERN_LEN]
        self._require(len(pattern) >= 8, "Spec pattern is too short to match anything useful")

        code = str(reason_code).strip().upper()
        self._require(code in REASON_CODES, f"Unknown reason code: {code}")

        ptype = str(predicate_type).strip().lower()
        self._require(ptype in PREDICATE_TYPES, f"Unknown predicate type: {ptype}")

        verdict = str(outcome).strip()[:120]
        self._require(len(verdict) >= 1, "Precedent must record an outcome")

        tags = self._parse_tags(tags_csv)
        self._require(len(tags) >= 1, "Precedent needs at least one usable tag")

        version = str(charter_version).strip()
        self._require(version in self.charters, f"Charter {version} has not been published")

        now = int(self._now())
        record = {
            "precedent_id": pid,
            "market_id": market,
            "spec_pattern": pattern,
            "tags": tags,
            "outcome": verdict,
            "reason_code": code,
            "predicate_type": ptype,
            "charter_version": version,
            "ruling_note": str(ruling_note).strip()[:MAX_NOTE_LEN],
            "recorded_by": str(gl.message.sender_address),
            "recorded_at": now,
            "sequence": int(self.total_precedents) + 1,
        }
        self.precedents[pid] = self._canonical(record)
        self.precedent_ids.append(pid)
        self.total_precedents = u256(int(self.total_precedents) + 1)

        for tag in tags:
            bucket = self._read_tag_bucket(tag)
            if pid not in bucket:
                bucket.append(pid)
                if not self.tag_index.get(tag, ""):
                    self.tag_names.append(tag)
                self.tag_index[tag] = json.dumps(bucket, sort_keys=False)

        existing = self._read_market_bucket(market)
        if pid not in existing:
            existing.append(pid)
            self.market_precedents[market] = json.dumps(existing, sort_keys=False)

        return self.precedents[pid]

    def _read_market_bucket(self, market_id: str) -> list:
        stored = self.market_precedents.get(str(market_id).strip(), "")
        if not stored:
            return []
        try:
            parsed = json.loads(stored)
        except Exception:
            return []
        return parsed if isinstance(parsed, list) else []

    @gl.public.view
    def get_precedent(self, precedent_id: str) -> str:
        return self.precedents.get(str(precedent_id).strip(), "")

    @gl.public.view
    def lookup_by_tag(self, tag: str) -> str:
        needle = self._normalize_tag(tag)
        bucket = self._read_tag_bucket(needle)
        rows = []
        for pid in bucket:
            stored = self.precedents.get(str(pid), "")
            if stored:
                rows.append(json.loads(stored))
        return json.dumps({"tag": needle, "matches": rows, "count": len(rows)}, sort_keys=True)

    @gl.public.view
    def lookup_for_spec(self, tags_csv: str, limit: int = 5) -> str:
        """
        Deterministic precedent lookup for the compiler and the resolver.

        Ranking is overlap first, then recency, then id. All three keys come from stored
        state, so every validator that runs this lookup gets byte identical output.
        """
        wanted = self._parse_tags(tags_csv)
        cap = max(1, min(int(limit), 25))

        overlap = {}
        for tag in wanted:
            for pid in self._read_tag_bucket(tag):
                key = str(pid)
                overlap[key] = overlap.get(key, 0) + 1

        candidates = []
        for pid, hits in overlap.items():
            stored = self.precedents.get(pid, "")
            if not stored:
                continue
            record = json.loads(stored)
            candidates.append((hits, int(record.get("sequence", 0)), pid, record))

        candidates.sort(key=lambda row: (-row[0], -row[1], row[2]))
        matches = []
        for hits, _seq, _pid, record in candidates[:cap]:
            enriched = dict(record)
            enriched["tag_overlap"] = hits
            matches.append(enriched)

        return json.dumps(
            {
                "query_tags": wanted,
                "matches": matches,
                "count": len(matches),
                "considered": len(candidates),
            },
            sort_keys=True,
        )

    @gl.public.view
    def get_precedents_for_market(self, market_id: str) -> str:
        rows = []
        for pid in self._read_market_bucket(market_id):
            stored = self.precedents.get(str(pid), "")
            if stored:
                rows.append(json.loads(stored))
        return json.dumps(
            {"market_id": str(market_id).strip(), "precedents": rows, "count": len(rows)},
            sort_keys=True,
        )

    @gl.public.view
    def list_tags(self) -> str:
        rows = []
        for tag in self.tag_names:
            name = str(tag)
            rows.append({"tag": name, "count": len(self._read_tag_bucket(name))})
        rows.sort(key=lambda row: (-row["count"], row["tag"]))
        return json.dumps({"tags": rows, "count": len(rows)}, sort_keys=True)

    @gl.public.view
    def get_registry_stats(self) -> str:
        return json.dumps(
            {
                "owner": str(self.owner),
                "active_version": self.active_version,
                "charter_count": int(self.charter_count),
                "total_precedents": int(self.total_precedents),
                "tag_count": len(self.tag_names),
                "registrar_count": len([a for a in self.registrar_list if str(a) in self.registrars]),
                "reason_codes": list(REASON_CODES),
                "predicate_types": list(PREDICATE_TYPES),
                "tie_handling_options": list(TIE_HANDLING),
                "ambiguity_policies": list(AMBIGUITY_POLICIES),
            },
            sort_keys=True,
        )
