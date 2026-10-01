"""
tests/direct/precedent_rules.py
===============================

The charter's acceptance rules for `record_precedent`, written once.

Direct mode can only load one contract class per test, so the settlement write
back has to be proved from both ends:

* `tests/direct/test_market.py` settles a market, captures the `record_precedent`
  call it emits, and asserts the arguments satisfy these rules.
* `tests/direct/test_charter.py` feeds a payload of exactly this shape to a real
  VantageCharter and asserts it is stored and served back by tag.

Both halves import this module, so neither can drift from the registry's actual
contract without the other failing.
"""

# Mirrors VantageCharter.record_precedent's positional signature.
ARG_ORDER = (
    "precedent_id",
    "market_id",
    "spec_pattern",
    "tags_csv",
    "outcome",
    "reason_code",
    "predicate_type",
    "charter_version",
    "ruling_note",
)

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

PREDICATE_TYPES = ("numeric", "event", "subjective")

MAX_PATTERN_LEN = 600
MAX_NOTE_LEN = 800
MAX_TAG_LEN = 48
TAG_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789-_."


def normalize_tag(raw: str) -> str:
    """VantageCharter._normalize_tag, reproduced."""
    value = str(raw).strip().lower().replace(" ", "-")
    kept = "".join(ch for ch in value if ch in TAG_ALPHABET)
    while "--" in kept:
        kept = kept.replace("--", "-")
    return kept.strip("-._")[:MAX_TAG_LEN]


def usable_tags(tags_csv: str) -> list:
    """The tags the registry will actually keep out of a csv argument."""
    ordered = []
    for chunk in str(tags_csv).split(","):
        tag = normalize_tag(chunk)
        if len(tag) >= 2 and tag not in ordered:
            ordered.append(tag)
    return ordered[:12]


def assert_charter_accepts(payload: dict, charter_version: str = "v1") -> None:
    """
    Every `self._require` in VantageCharter.record_precedent, as assertions.

    A payload that clears these is one the registry will store; a payload that
    does not would revert the emitted write and silently lose the precedent.
    """
    assert set(payload) == set(ARG_ORDER), f"unexpected argument set: {sorted(payload)}"
    assert len(str(payload["precedent_id"]).strip()) >= 3, "precedent id too short"
    assert len(str(payload["market_id"]).strip()) >= 1, "precedent must reference a market"

    pattern = str(payload["spec_pattern"]).strip()
    assert len(pattern) >= 8, f"spec pattern too short to match anything: {pattern!r}"
    assert len(pattern) <= MAX_PATTERN_LEN, "spec pattern over the registry limit"

    assert str(payload["reason_code"]).strip().upper() in REASON_CODES, (
        f"reason code not in the enum: {payload['reason_code']!r}"
    )
    assert str(payload["predicate_type"]).strip().lower() in PREDICATE_TYPES, (
        f"predicate type not in the enum: {payload['predicate_type']!r}"
    )
    assert len(str(payload["outcome"]).strip()) >= 1, "precedent must record an outcome"
    assert len(usable_tags(payload["tags_csv"])) >= 1, (
        f"no usable tag survives normalization: {payload['tags_csv']!r}"
    )
    assert str(payload["charter_version"]).strip() == charter_version, (
        "precedent must pin a published charter version"
    )
    assert len(str(payload["ruling_note"])) <= MAX_NOTE_LEN, "ruling note over the registry limit"


def positional(payload: dict) -> list:
    """Payload as the positional argument list the market emits."""
    return [payload[name] for name in ARG_ORDER]


# A payload of the exact shape VantageMarket.settle emits, used by the charter
# side of the write back test. test_market asserts a live settlement produces a
# payload that satisfies assert_charter_accepts; this is that payload.
SETTLED_MARKET_PAYLOAD = {
    "precedent_id": "prec-vm1-9f2c4a7b01",
    "market_id": "vm1-9f2c4a7b01",
    "spec_pattern": "numeric | price_usd gte 5000 USD | ETH/USD price is above 5000 at close time",
    "tags_csv": "ethereum,crypto,price,threshold",
    "outcome": "Yes",
    "reason_code": "QUORUM_MET",
    "predicate_type": "numeric",
    "charter_version": "v1",
    "ruling_note": "Settled from 3 whitelisted source hosts against spec 0xdeadbeefdeadbe.",
}
