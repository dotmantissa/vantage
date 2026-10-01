"""
tests/direct/test_market.py
============================

Direct-mode unit tests for VantageMarket.

VantageMarket reads VantageCharter via cross-contract view calls. In direct
mode only one contract class can be loaded per test, so we intercept the
CallContract gl_call requests via vm._gl_call_hook and return mocked charter
data in calldata-encoded form.

Covers:
- Deployment and constructor validation
- compile_market (mock-driven spec compilation + consensus testing)
- AMM: buy, sell, add_liquidity, remove_liquidity
- Lifecycle: close_market, resolve, finalize, settle
- Contest: challenge, resolve_challenge, appeal, resolve_appeal
- Void: void_expired
- Views: get_market, get_prices, get_position, get_balance, list_markets, get_stats
- Admin: fund_court, set_keeper_bounty
"""

import json
import pytest
import time
from pathlib import Path
from unittest.mock import MagicMock
from gltest.direct.sdk_loader import setup_sdk_paths

setup_sdk_paths(Path("contracts/vantage_market.py"))
from genlayer.py import calldata

import precedent_rules

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

MARKET_PATH = "contracts/vantage_market.py"

BOND_WEI = 5_000_000_000_000_000_000        # 5 GEN
CHALLENGE_BOND_WEI = 10_000_000_000_000_000_000  # 10 GEN
APPEAL_BOND_WEI = 25_000_000_000_000_000_000     # 25 GEN
SEED_WEI = 10_000_000_000_000_000_000        # 10 GEN
BUY_WEI = 2_000_000_000_000_000_000         # 2 GEN


def addr_hex(addr) -> str:
    if hasattr(addr, "as_hex"):
        return addr.as_hex
    if isinstance(addr, (bytes, bytearray)):
        return "0x" + addr.hex()
    return str(addr)


def now_ts() -> int:
    return int(time.time())


# ---------------------------------------------------------------------------
# Charter mock data
# ---------------------------------------------------------------------------

MOCK_CHARTER = {
    "version": "v1",
    "ranked_sources": ["api.github.com", "api.coingecko.com", "www.federalreserve.gov"],
    "timezone": "UTC",
    "tie_handling": "VOID",
    "default_quorum_k": 2,
    "default_quorum_n": 3,
    "ambiguity_policy": "VOID_AND_SLASH_AUTHOR",
    "challenge_window_seconds": 3600,
    "appeal_window_seconds": 3600,
    "grace_period_seconds": 86400,
    "numeric_tolerance_bps": 100,
    "dual_run_threshold_wei": "0",
    "published_at": 0,
    "published_by": "0x0000000000000000000000000000000000000001",
    "charter_hash": "0xdeadbeef",
}

MOCK_CHARTER_JSON = json.dumps(MOCK_CHARTER, sort_keys=True)
MOCK_PRECEDENTS_JSON = json.dumps({"query_tags": [], "matches": [], "count": 0, "considered": 0}, sort_keys=True)


def captured_messages(direct_vm):
    """Every PostMessage the contract emitted, newest last."""
    return list(getattr(direct_vm, "_vantage_messages", []))


def reset_messages(direct_vm):
    setattr(direct_vm, "_vantage_messages", [])


def emitted_calls(direct_vm, method: str):
    """Emitted cross-contract writes for one method name."""
    rows = []
    for message in captured_messages(direct_vm):
        calldata_obj = message.get("calldata", {})
        if isinstance(calldata_obj, dict) and calldata_obj.get("method") == method:
            rows.append(message)
    return rows


def emitted_transfers(direct_vm):
    """Emitted bare value transfers: a PostMessage with no method."""
    rows = []
    for message in captured_messages(direct_vm):
        calldata_obj = message.get("calldata", {})
        if not isinstance(calldata_obj, dict) or not calldata_obj.get("method"):
            rows.append(message)
    return rows


def install_charter_hook(direct_vm):
    """
    Install a _gl_call_hook that intercepts CallContract requests to the charter
    address and returns mocked sub-VM calldata-encoded responses (code 0 + calldata).

    Emitted PostMessage requests (cross-contract writes and value transfers) are
    recorded on the VM so tests can assert on the precedent write back and on
    withdrawal payouts.
    """
    def hook(vm, request):
        if "PostMessage" in request:
            bucket = getattr(vm, "_vantage_messages", None)
            if bucket is None:
                bucket = []
                setattr(vm, "_vantage_messages", bucket)
            bucket.append(request["PostMessage"])
            return {"ok": None}
        if "CallContract" not in request:
            return None
        cc = request["CallContract"]
        cd = cc.get("calldata", {})
        method = None
        if isinstance(cd, dict):
            method = cd.get("method") or cd.get("method_name")
        if method is None:
            return None
        if method in ("get_active_charter", "get_charter"):
            return bytes([0]) + calldata.encode(MOCK_CHARTER_JSON)
        if method == "lookup_for_spec":
            return bytes([0]) + calldata.encode(MOCK_PRECEDENTS_JSON)
        # Unknown charter method — return empty string
        return bytes([0]) + calldata.encode("")

    direct_vm._gl_call_hook = hook


# ---------------------------------------------------------------------------
# Mock LLM responses
# ---------------------------------------------------------------------------

COMPILE_RESPONSE = json.dumps({
    "restated_question": "Will ETH price exceed $5000 on api.coingecko.com by 2025-12-31?",
    "outcomes": ["Yes", "No"],
    "predicate_type": "numeric",
    "predicate": "ETH/USD price is above 5000 at close time",
    "predicate_field": "price_usd",
    "comparator": "gte",
    "threshold": "5000",
    "units": "USD",
    "sanity_min": "100",
    "sanity_max": "1000000",
    "fact_schema": {"price_usd": "number"},
    "sources": [
        "api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
        "api.github.com/repos/ethereum/go-ethereum",
        "www.federalreserve.gov/releases/h15/",
    ],
    "tags": ["ethereum", "crypto", "price", "threshold"],
    "criteria": "",
    "resolvable": True,
    "issues": [],
    "suggested_rewrites": [],
})

SINGLE_HOST_RESPONSE = json.dumps({
    "restated_question": "Will ETH price exceed $5000 on api.coingecko.com by 2025-12-31?",
    "outcomes": ["Yes", "No"],
    "predicate_type": "numeric",
    "predicate": "ETH/USD price is above 5000 at close time",
    "predicate_field": "price_usd",
    "comparator": "gte",
    "threshold": "5000",
    "units": "USD",
    "sanity_min": "100",
    "sanity_max": "1000000",
    "fact_schema": {"price_usd": "number"},
    # Three paths, one host. That is one source wearing three hats.
    "sources": [
        "api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
        "api.coingecko.com/api/v3/coins/ethereum",
        "api.coingecko.com/api/v3/exchange_rates",
    ],
    "tags": ["ethereum", "crypto", "price"],
    "criteria": "",
    "resolvable": True,
    "issues": [],
    "suggested_rewrites": [],
})

OFF_WHITELIST_RESPONSE = json.dumps({
    "restated_question": "Will ETH price exceed $5000 by 2025-12-31?",
    "outcomes": ["Yes", "No"],
    "predicate_type": "numeric",
    "predicate": "ETH/USD price is above 5000 at close time",
    "predicate_field": "price_usd",
    "comparator": "gte",
    "threshold": "5000",
    "units": "USD",
    "sanity_min": "100",
    "sanity_max": "1000000",
    "fact_schema": {"price_usd": "number"},
    "sources": [
        "evil.example.com/price?ids=ethereum",
        "pastebin.com/raw/abcdef",
    ],
    "tags": ["ethereum", "crypto", "price"],
    "criteria": "",
    "resolvable": True,
    "issues": [],
    "suggested_rewrites": [],
})

UNRESOLVABLE_RESPONSE = json.dumps({
    "restated_question": "Will it rain tomorrow?",
    "outcomes": ["Yes", "No"],
    "predicate_type": "numeric",
    "predicate": "Rain tomorrow",
    "predicate_field": "",
    "comparator": "",
    "threshold": "",
    "units": "",
    "sanity_min": "",
    "sanity_max": "",
    "fact_schema": {},
    "sources": [],
    "tags": ["weather"],
    "criteria": "",
    "resolvable": False,
    "issues": ["No numeric field specified", "No comparator specified", "No sources available"],
    "suggested_rewrites": ["Ask about measurable rainfall amount from api.weather.gov"],
})


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

FAKE_CHARTER_ADDR = "0x" + "ca" * 20  # 42-char dummy address


@pytest.fixture
def market(direct_deploy, direct_vm):
    """Deploy VantageMarket with charter cross-contract calls mocked."""
    install_charter_hook(direct_vm)
    return direct_deploy(
        MARKET_PATH,
        charter_address=FAKE_CHARTER_ADDR,
        fee_bps_total=200,
        fee_bps_lp=120,
        fee_bps_creator=40,
        fee_bps_court=40,
        author_bond_wei=str(BOND_WEI),
        challenge_bond_wei=str(CHALLENGE_BOND_WEI),
        appeal_bond_wei=str(APPEAL_BOND_WEI),
        keeper_bounty_wei="0",
    )


def _create_market(market, direct_vm, close=None) -> str:
    """Helper: compile a market and return its market_id."""
    install_charter_hook(direct_vm)
    direct_vm.mock_llm(".*spec compiler.*", COMPILE_RESPONSE)
    direct_vm.value = BOND_WEI + SEED_WEI
    result = json.loads(market.compile_market(
        "Will ETH price exceed $5000 by end of 2025?",
        close or (now_ts() + 86400),
        str(SEED_WEI),
    ))
    assert result["created"] is True, f"Market creation failed: {result}"
    direct_vm.clear_mocks()
    install_charter_hook(direct_vm)
    return result["market_id"]


# ---------------------------------------------------------------------------
# Deployment
# ---------------------------------------------------------------------------

class TestMarketDeployment:
    def test_deploys_successfully(self, market):
        stats = json.loads(market.get_stats())
        assert stats["market_count"] == 0
        assert int(stats["court_fund_wei"]) == 0

    def test_fee_split_must_sum_to_total(self, direct_deploy, direct_vm):
        install_charter_hook(direct_vm)
        with direct_vm.expect_revert("[EXPECTED]"):
            direct_deploy(
                MARKET_PATH,
                charter_address=FAKE_CHARTER_ADDR,
                fee_bps_total=200,
                fee_bps_lp=100,
                fee_bps_creator=40,
                fee_bps_court=40,
            )

    def test_fee_cannot_exceed_10pct(self, direct_deploy, direct_vm):
        install_charter_hook(direct_vm)
        with direct_vm.expect_revert("[EXPECTED]"):
            direct_deploy(
                MARKET_PATH,
                charter_address=FAKE_CHARTER_ADDR,
                fee_bps_total=1200,
                fee_bps_lp=700,
                fee_bps_creator=250,
                fee_bps_court=250,
            )


# ---------------------------------------------------------------------------
# compile_market
# ---------------------------------------------------------------------------

class TestCompileMarket:
    def test_compile_resolvable_market(self, market, direct_vm):
        direct_vm.mock_llm(".*spec compiler.*", COMPILE_RESPONSE)
        direct_vm.value = BOND_WEI + SEED_WEI
        result = json.loads(market.compile_market(
            "Will ETH price exceed $5000 by end of 2025?",
            now_ts() + 7200,
            str(SEED_WEI),
        ))
        assert result["created"] is True
        assert result["predicate_type"] == "numeric"
        assert len(result["market_id"]) > 4

    def test_compile_short_question_fails(self, market, direct_vm):
        direct_vm.value = BOND_WEI
        with direct_vm.expect_revert("[EXPECTED]"):
            market.compile_market("Hi?", now_ts() + 7200)

    def test_compile_close_time_in_past_fails(self, market, direct_vm):
        direct_vm.mock_llm(".*", COMPILE_RESPONSE)
        direct_vm.value = BOND_WEI
        with direct_vm.expect_revert("[EXPECTED]"):
            market.compile_market(
                "Will ETH price exceed $5000 by end of 2025?",
                now_ts() - 100,
            )

    def test_compile_insufficient_bond_fails(self, market, direct_vm):
        direct_vm.value = 1
        with direct_vm.expect_revert("[EXPECTED]"):
            market.compile_market(
                "Will ETH price exceed $5000 by end of 2025?",
                now_ts() + 7200,
            )

    def test_compile_unresolvable_returns_feedback(self, market, direct_vm):
        direct_vm.mock_llm(".*spec compiler.*", UNRESOLVABLE_RESPONSE)
        direct_vm.value = BOND_WEI
        result = json.loads(market.compile_market(
            "Will it rain tomorrow somewhere in the world?",
            now_ts() + 7200,
        ))
        assert result["created"] is False
        assert result["reason"] == "NOT_RESOLVABLE"
        assert len(result["problems"]) > 0
        assert int(result["refunded_wei"]) == BOND_WEI

    def test_list_markets_after_creation(self, market, direct_vm):
        _create_market(market, direct_vm)
        listing = json.loads(market.list_markets())
        assert listing["total"] == 1

    def test_compile_consensus_validator_agrees(self, market, direct_vm):
        direct_vm.mock_llm(".*spec compiler.*", COMPILE_RESPONSE)
        direct_vm.value = BOND_WEI + SEED_WEI
        result = json.loads(market.compile_market(
            "Will ETH price exceed $5000 by end of 2025?",
            now_ts() + 7200,
            str(SEED_WEI),
        ))
        assert result["created"] is True
        agree = direct_vm.run_validator()
        assert agree is True

    def test_compile_consensus_validator_disagrees(self, market, direct_vm):
        direct_vm.mock_llm(".*spec compiler.*", COMPILE_RESPONSE)
        direct_vm.value = BOND_WEI + SEED_WEI
        market.compile_market(
            "Will ETH price exceed $5000 by end of 2025?",
            now_ts() + 7200,
            str(SEED_WEI),
        )
        direct_vm.clear_mocks()
        install_charter_hook(direct_vm)
        direct_vm.mock_llm(".*spec compiler.*", UNRESOLVABLE_RESPONSE)
        agree = direct_vm.run_validator()
        assert agree is False


# ---------------------------------------------------------------------------
# AMM
# ---------------------------------------------------------------------------

class TestAMM:
    def test_buy_shares(self, market, direct_vm):
        mid = _create_market(market, direct_vm)
        direct_vm.value = BUY_WEI
        result = json.loads(market.buy(mid, 0))
        assert result["market_id"] == mid
        assert int(result["shares_out"]) > 0
        assert result["outcome_index"] == 0

    def test_buy_updates_position(self, market, direct_vm, direct_owner):
        mid = _create_market(market, direct_vm)
        direct_vm.value = BUY_WEI
        market.buy(mid, 0)
        pos = json.loads(market.get_position(mid, addr_hex(direct_owner)))
        assert int(pos["shares"].get("0", "0")) > 0

    def test_buy_wrong_market_fails(self, market, direct_vm):
        _create_market(market, direct_vm)
        direct_vm.value = BUY_WEI
        with direct_vm.expect_revert("[EXPECTED]"):
            market.buy("nonexistent-market", 0)

    def test_buy_invalid_outcome_fails(self, market, direct_vm):
        mid = _create_market(market, direct_vm)
        direct_vm.value = BUY_WEI
        with direct_vm.expect_revert("[EXPECTED]"):
            market.buy(mid, 99)

    def test_prices_sum_to_denom(self, market, direct_vm):
        mid = _create_market(market, direct_vm)
        prices = json.loads(market.get_prices(mid))
        assert sum(prices["prices_bps"]) == 10000

    def test_sell_shares(self, market, direct_vm):
        mid = _create_market(market, direct_vm)
        direct_vm.value = BUY_WEI
        buy_result = json.loads(market.buy(mid, 0))
        shares = buy_result["shares_out"]
        sell_shares = str(int(shares) // 2)
        if int(sell_shares) == 0:
            pytest.skip("Too few shares to sell")
        result = json.loads(market.sell(mid, 0, sell_shares))
        assert result["market_id"] == mid
        assert int(result["collateral_out"]) > 0

    def test_sell_more_than_held_fails(self, market, direct_vm):
        mid = _create_market(market, direct_vm)
        direct_vm.value = BUY_WEI
        market.buy(mid, 0)
        with direct_vm.expect_revert("[EXPECTED]"):
            market.sell(mid, 0, str(10**30))

    def test_add_then_remove_liquidity(self, market, direct_vm, direct_owner):
        mid = _create_market(market, direct_vm)
        direct_vm.value = SEED_WEI
        market.add_liquidity(mid)
        pos_before = json.loads(market.get_position(mid, addr_hex(direct_owner)))
        lp_before = int(pos_before["lp_shares"])
        assert lp_before > 0
        remove_result = json.loads(market.remove_liquidity(mid, str(lp_before // 2)))
        assert int(remove_result["collateral_returned_wei"]) >= 0

    def test_add_liquidity_closed_market_fails(self, market, direct_vm):
        close = now_ts() + 400
        mid = _create_market(market, direct_vm, close=close)
        direct_vm.warp("2090-01-01T00:00:00Z")
        market.close_market(mid)
        direct_vm.value = SEED_WEI
        with direct_vm.expect_revert("[EXPECTED]"):
            market.add_liquidity(mid)


# ---------------------------------------------------------------------------
# Lifecycle
# ---------------------------------------------------------------------------

def _ev_response(spec_hash: str, outcome_index: int, value) -> str:
    val = int(value) if isinstance(value, float) and value.is_integer() else value
    return json.dumps({
        "spec_hash": spec_hash,
        "found": True,
        "extracted_value": val,
        "outcome_index": outcome_index,
        "fact": {"price_usd": str(val)},
    })


class TestLifecycle:
    def _setup(self, market, direct_vm, close=None):
        mid = _create_market(market, direct_vm, close=close or (now_ts() + 400))
        spec = json.loads(market.get_spec(mid))
        return mid, spec.get("spec_hash", "")

    def test_close_market(self, market, direct_vm):
        mid, _ = self._setup(market, direct_vm)
        direct_vm.warp("2090-01-01T00:00:00Z")
        result = json.loads(market.close_market(mid))
        assert result["state"] == "CLOSED"

    def test_close_market_before_time_fails(self, market, direct_vm):
        mid, _ = self._setup(market, direct_vm)
        with direct_vm.expect_revert("[EXPECTED]"):
            market.close_market(mid)

    def test_resolve_reaches_provisional(self, market, direct_vm):
        mid, spec_hash = self._setup(market, direct_vm)
        direct_vm.warp("2090-01-01T00:00:00Z")
        market.close_market(mid)
        direct_vm.mock_web(".*", {"status": 200, "body": "price: $6000"})
        direct_vm.mock_llm(".*fact extractor.*", _ev_response(spec_hash, 0, 6000.0))
        result = json.loads(market.resolve(mid))
        assert result["state"] == "PROVISIONAL"
        assert result["winning_outcome"] == 0

    def test_resolve_consensus_agrees(self, market, direct_vm):
        mid, spec_hash = self._setup(market, direct_vm)
        direct_vm.warp("2090-01-01T00:00:00Z")
        market.close_market(mid)
        direct_vm.mock_web(".*", {"status": 200, "body": "price: $6000"})
        direct_vm.mock_llm(".*fact extractor.*", _ev_response(spec_hash, 0, 6000.0))
        market.resolve(mid)
        agree = direct_vm.run_validator()
        assert agree is True

    def test_resolve_consensus_disagrees(self, market, direct_vm):
        mid, spec_hash = self._setup(market, direct_vm)
        direct_vm.warp("2090-01-01T00:00:00Z")
        market.close_market(mid)
        direct_vm.mock_web(".*", {"status": 200, "body": "price: $6000"})
        direct_vm.mock_llm(".*fact extractor.*", _ev_response(spec_hash, 0, 6000.0))
        market.resolve(mid)
        direct_vm.clear_mocks()
        install_charter_hook(direct_vm)
        direct_vm.mock_web(".*", {"status": 200, "body": "price: $3000"})
        direct_vm.mock_llm(".*fact extractor.*", _ev_response(spec_hash, 1, 3000.0))
        agree = direct_vm.run_validator()
        assert agree is False

    def test_finalize_after_appeal_window(self, market, direct_vm):
        mid, spec_hash = self._setup(market, direct_vm)
        direct_vm.warp("2090-01-01T00:00:00Z")
        market.close_market(mid)
        direct_vm.mock_web(".*", {"status": 200, "body": "price: $6000"})
        direct_vm.mock_llm(".*fact extractor.*", _ev_response(spec_hash, 0, 6000.0))
        market.resolve(mid)
        direct_vm.warp("2090-01-05T00:00:00Z")
        result = json.loads(market.finalize(mid))
        assert result["state"] == "FINAL"

    def test_finalize_before_window_fails(self, market, direct_vm):
        mid, spec_hash = self._setup(market, direct_vm)
        direct_vm.warp("2090-01-01T00:00:00Z")
        market.close_market(mid)
        direct_vm.mock_web(".*", {"status": 200, "body": "price: $6000"})
        direct_vm.mock_llm(".*fact extractor.*", _ev_response(spec_hash, 0, 6000.0))
        market.resolve(mid)
        with direct_vm.expect_revert("[EXPECTED]"):
            market.finalize(mid)

    def test_settle_completes(self, market, direct_vm, direct_alice):
        mid, spec_hash = self._setup(market, direct_vm)
        # Alice buys YES
        with direct_vm.prank(direct_alice):
            direct_vm.value = BUY_WEI
            market.buy(mid, 0)
        direct_vm.warp("2090-01-01T00:00:00Z")
        market.close_market(mid)
        direct_vm.mock_web(".*", {"status": 200, "body": "price: $6000"})
        direct_vm.mock_llm(".*fact extractor.*", _ev_response(spec_hash, 0, 6000.0))
        market.resolve(mid)
        direct_vm.warp("2090-01-05T00:00:00Z")
        market.finalize(mid)
        result = json.loads(market.settle(mid))
        assert result["state"] == "SETTLED"
        assert result["winning_outcome"] == 0


# ---------------------------------------------------------------------------
# Contest flow
# ---------------------------------------------------------------------------

class TestContest:
    def _resolved(self, market, direct_vm, outcome_index=0, value=6000.0):
        mid = _create_market(market, direct_vm, close=now_ts() + 400)
        spec = json.loads(market.get_spec(mid))
        spec_hash = spec.get("spec_hash", "")
        direct_vm.warp("2090-01-01T00:00:00Z")
        market.close_market(mid)
        direct_vm.mock_web(".*", {"status": 200, "body": "price: $6000"})
        direct_vm.mock_llm(".*fact extractor.*", _ev_response(spec_hash, outcome_index, value))
        market.resolve(mid)
        direct_vm.clear_mocks()
        install_charter_hook(direct_vm)
        return mid, spec_hash

    def test_challenge_transitions_to_challenged(self, market, direct_vm, direct_alice):
        mid, _ = self._resolved(market, direct_vm)
        with direct_vm.prank(direct_alice):
            direct_vm.value = CHALLENGE_BOND_WEI
            result = json.loads(market.challenge(mid, "api.coingecko.com"))
        assert result["state"] == "CHALLENGED"

    def test_challenge_without_bond_fails(self, market, direct_vm, direct_alice):
        mid, _ = self._resolved(market, direct_vm)
        with direct_vm.prank(direct_alice):
            direct_vm.value = 1
            with direct_vm.expect_revert("[EXPECTED]"):
                market.challenge(mid, "api.coingecko.com")

    def test_challenge_after_window_fails(self, market, direct_vm, direct_alice):
        mid, _ = self._resolved(market, direct_vm)
        direct_vm.warp("2090-01-05T00:00:00Z")
        with direct_vm.prank(direct_alice):
            direct_vm.value = CHALLENGE_BOND_WEI
            with direct_vm.expect_revert("[EXPECTED]"):
                market.challenge(mid, "api.coingecko.com")

    def test_resolve_challenge_returns_provisional(self, market, direct_vm, direct_alice):
        mid, spec_hash = self._resolved(market, direct_vm)
        with direct_vm.prank(direct_alice):
            direct_vm.value = CHALLENGE_BOND_WEI
            market.challenge(mid, "api.coingecko.com")
        # Mock contrary evidence
        contrary = _ev_response(spec_hash, 1, 3000.0)
        direct_vm.mock_web(".*", {"status": 200, "body": "price: $3000"})
        direct_vm.mock_llm(".*fact extractor.*", contrary)
        result = json.loads(market.resolve_challenge(mid))
        assert result["state"] == "PROVISIONAL"

    def test_appeal_transitions_to_appealed(self, market, direct_vm, direct_bob):
        mid, _ = self._resolved(market, direct_vm)
        with direct_vm.prank(direct_bob):
            direct_vm.value = APPEAL_BOND_WEI
            result = json.loads(market.appeal(mid))
        assert result["state"] == "APPEALED"

    def test_appeal_without_bond_fails(self, market, direct_vm, direct_bob):
        mid, _ = self._resolved(market, direct_vm)
        with direct_vm.prank(direct_bob):
            direct_vm.value = 1
            with direct_vm.expect_revert("[EXPECTED]"):
                market.appeal(mid)


# ---------------------------------------------------------------------------
# Void and grace period
# ---------------------------------------------------------------------------

class TestVoidExpired:
    def test_void_expired_after_grace_period(self, market, direct_vm):
        mid = _create_market(market, direct_vm, close=now_ts() + 400)
        direct_vm.warp("2100-01-01T00:00:00Z")
        result = json.loads(market.void_expired(mid))
        assert result["state"] == "VOID"
        assert result["reason"] == "GRACE_PERIOD_VOID"

    def test_void_before_grace_period_fails(self, market, direct_vm):
        mid = _create_market(market, direct_vm)
        with direct_vm.expect_revert("[EXPECTED]"):
            market.void_expired(mid)


# ---------------------------------------------------------------------------
# Views
# ---------------------------------------------------------------------------

class TestViews:
    def test_get_market_returns_data(self, market, direct_vm):
        mid = _create_market(market, direct_vm)
        m = json.loads(market.get_market(mid))
        assert m["market_id"] == mid
        assert m["state"] == "OPEN"

    def test_get_spec_returns_data(self, market, direct_vm):
        mid = _create_market(market, direct_vm)
        spec = json.loads(market.get_spec(mid))
        assert spec["predicate_type"] == "numeric"
        assert "spec_hash" in spec

    def test_get_balance_initially_zero(self, market, direct_vm, direct_alice):
        result = json.loads(market.get_balance(addr_hex(direct_alice)))
        assert int(result["balance_wei"]) == 0

    def test_get_contest_empty_initially(self, market, direct_vm):
        mid = _create_market(market, direct_vm)
        assert market.get_contest(mid) == ""

    def test_get_stats(self, market):
        stats = json.loads(market.get_stats())
        assert "market_count" in stats
        assert "fee_bps_total" in stats

    def test_get_markets_for_trader(self, market, direct_vm, direct_alice):
        mid = _create_market(market, direct_vm)
        with direct_vm.prank(direct_alice):
            direct_vm.value = BUY_WEI
            market.buy(mid, 0)
        result = json.loads(market.get_markets_for_trader(addr_hex(direct_alice)))
        assert mid in result["market_ids"]

    def test_list_markets_pagination(self, market, direct_vm):
        for _ in range(3):
            install_charter_hook(direct_vm)
            direct_vm.mock_llm(".*spec compiler.*", COMPILE_RESPONSE)
            direct_vm.value = BOND_WEI
            market.compile_market(
                "Will ETH price exceed $5000 by end of 2025?",
                now_ts() + 86400,
            )
            direct_vm.clear_mocks()
        result = json.loads(market.list_markets(0, 2))
        assert len(result["markets"]) == 2
        assert result["total"] == 3


# ---------------------------------------------------------------------------
# Admin
# ---------------------------------------------------------------------------

class TestAdmin:
    def test_fund_court(self, market, direct_vm):
        direct_vm.value = 1_000_000_000_000_000_000
        market.fund_court()
        stats = json.loads(market.get_stats())
        assert int(stats["court_fund_wei"]) == 1_000_000_000_000_000_000

    def test_set_keeper_bounty(self, market, direct_vm, direct_owner):
        with direct_vm.prank(direct_owner):
            market.set_keeper_bounty("1000000000000000000")
        stats = json.loads(market.get_stats())
        assert int(stats["keeper_bounty_wei"]) == 1_000_000_000_000_000_000

    def test_set_keeper_bounty_non_owner_fails(self, market, direct_vm, direct_alice):
        with direct_vm.prank(direct_alice):
            with direct_vm.expect_revert("[EXPECTED]"):
                market.set_keeper_bounty("0")


# ---------------------------------------------------------------------------
# Settlement: one wei a share, conserved, credited exactly, withdrawable
# ---------------------------------------------------------------------------


def _settled(market, direct_vm, buyers=(), winner_value=6000.0, seed=SEED_WEI):
    """
    Drive a market all the way to SETTLED.

    `buyers` is a list of (address, outcome_index, wei) applied while the market
    is open. Returns (market_id, settle_result, spec).
    """
    install_charter_hook(direct_vm)
    direct_vm.mock_llm(".*spec compiler.*", COMPILE_RESPONSE)
    direct_vm.value = BOND_WEI + seed
    created = json.loads(market.compile_market(
        "Will ETH price exceed $5000 by end of 2025?",
        now_ts() + 400,
        str(seed),
    ))
    assert created["created"] is True, created
    mid = created["market_id"]
    direct_vm.clear_mocks()
    install_charter_hook(direct_vm)

    for who, outcome, amount in buyers:
        with direct_vm.prank(who):
            direct_vm.value = amount
            market.buy(mid, outcome)

    spec = json.loads(market.get_spec(mid))
    direct_vm.warp("2090-01-01T00:00:00Z")
    market.close_market(mid)
    direct_vm.mock_web(".*", {"status": 200, "body": f"price: ${winner_value}"})
    direct_vm.mock_llm(".*fact extractor.*", _ev_response(spec["spec_hash"], 0, winner_value))
    market.resolve(mid)
    direct_vm.clear_mocks()
    install_charter_hook(direct_vm)
    direct_vm.warp("2090-01-05T00:00:00Z")
    market.finalize(mid)
    reset_messages(direct_vm)
    result = json.loads(market.settle(mid))
    return mid, result, spec


class TestSettlementValue:
    def test_winning_share_redeems_exactly_one_wei(self, market, direct_vm, direct_alice):
        mid, result, _ = _settled(market, direct_vm, buyers=[(direct_alice, 0, BUY_WEI)])
        assert result["state"] == "SETTLED"
        assert result["payout_per_share_wei"] == "1"

        pos = json.loads(market.get_position(mid, addr_hex(direct_alice)))
        shares = int(pos["shares"]["0"])
        assert shares > 0
        # One wei a share, so the credit is the share count itself.
        assert int(result["winning_shares_redeemed"]) == shares
        assert int(result["holder_payout_wei"]) == shares

    def test_credits_the_winner_exactly_and_the_loser_nothing(
        self, market, direct_vm, direct_alice, direct_bob
    ):
        mid, result, _ = _settled(
            market,
            direct_vm,
            buyers=[(direct_alice, 0, BUY_WEI), (direct_bob, 1, BUY_WEI)],
        )
        alice_shares = int(json.loads(market.get_position(mid, addr_hex(direct_alice)))["shares"]["0"])
        bob_shares = int(json.loads(market.get_position(mid, addr_hex(direct_bob)))["shares"]["1"])
        assert alice_shares > 0 and bob_shares > 0

        alice_balance = int(json.loads(market.get_balance(addr_hex(direct_alice)))["balance_wei"])
        bob_balance = int(json.loads(market.get_balance(addr_hex(direct_bob)))["balance_wei"])
        assert alice_balance == alice_shares, "winner credited one wei a share, exactly"
        assert bob_balance == 0, "losing shares are worth nothing"
        assert int(result["holder_payout_wei"]) == alice_shares

    def test_settlement_conserves_collateral(self, market, direct_vm, direct_alice, direct_bob):
        mid, result, _ = _settled(
            market,
            direct_vm,
            buyers=[(direct_alice, 0, BUY_WEI), (direct_bob, 1, BUY_WEI)],
        )
        holder = int(result["holder_payout_wei"])
        lp = int(result["lp_payout_wei"])
        total = int(result["total_credited_wei"])
        collateral = int(result["collateral_wei"])
        minted = int(result["minted_wei"])

        assert total == holder + lp
        assert total <= collateral, "settlement cannot pay out more than the market holds"
        assert collateral == minted, "one wei in, one complete set out"
        # The pool's winning shares are the only other claim on the collateral, so
        # between holders and LPs the whole book is accounted for.
        assert holder + int(result["lp_pool_shares"]) == minted
        # A single LP holds every LP share here, so there is nothing left to round.
        assert total == collateral

    def test_book_conserves_through_trades(self, market, direct_vm, direct_alice, direct_bob):
        mid = _create_market(market, direct_vm)
        with direct_vm.prank(direct_alice):
            direct_vm.value = BUY_WEI
            market.buy(mid, 0)
        with direct_vm.prank(direct_bob):
            direct_vm.value = BUY_WEI
            market.buy(mid, 1)
        with direct_vm.prank(direct_alice):
            held = int(json.loads(market.get_position(mid, addr_hex(direct_alice)))["shares"]["0"])
            market.sell(mid, 0, str(held // 2))

        book = json.loads(market.get_book(mid))
        minted = int(book["minted_wei"])
        assert book["wei_per_winning_share"] == "1"
        assert int(book["collateral_wei"]) == minted, "collateral must back every minted set"
        for outstanding in book["outstanding"]:
            assert int(outstanding) == minted, (
                f"reserve plus held shares must equal minted for every outcome: {book}"
            )

    def test_withdraw_pays_the_holder_and_zeroes_the_balance(
        self, market, direct_vm, direct_alice
    ):
        mid, _, _ = _settled(market, direct_vm, buyers=[(direct_alice, 0, BUY_WEI)])
        owed = int(json.loads(market.get_balance(addr_hex(direct_alice)))["balance_wei"])
        assert owed > 0

        reset_messages(direct_vm)
        with direct_vm.prank(direct_alice):
            payout = json.loads(market.withdraw())

        assert int(payout["withdrawn_wei"]) == owed
        transfers = emitted_transfers(direct_vm)
        assert len(transfers) == 1, f"expected one value transfer, got {transfers}"
        assert int(transfers[0]["value"]) == owed
        assert addr_hex(transfers[0]["address"]).lower() == addr_hex(direct_alice).lower()
        assert int(json.loads(market.get_balance(addr_hex(direct_alice)))["balance_wei"]) == 0

        with direct_vm.prank(direct_alice):
            with direct_vm.expect_revert("[EXPECTED]"):
                market.withdraw()

    def test_void_refunds_traders_and_liquidity(self, market, direct_vm, direct_alice):
        mid = _create_market(market, direct_vm, close=now_ts() + 400)
        with direct_vm.prank(direct_alice):
            direct_vm.value = BUY_WEI
            market.buy(mid, 0)
        collateral = int(json.loads(market.get_book(mid))["collateral_wei"])

        direct_vm.warp("2100-01-01T00:00:00Z")
        result = json.loads(market.void_expired(mid))
        assert result["state"] == "VOID"

        voided = json.loads(market.get_market(mid))
        refunded = int(voided["voided_refund_wei"])
        assert refunded > 0, "a void has to return the collateral, not strand it"
        assert refunded <= collateral
        assert int(json.loads(market.get_balance(addr_hex(direct_alice)))["balance_wei"]) > 0


# ---------------------------------------------------------------------------
# Precedent write back
# ---------------------------------------------------------------------------

class TestPrecedentWriteBack:
    def test_settlement_calls_record_precedent(self, market, direct_vm, direct_alice):
        mid, result, _ = _settled(market, direct_vm, buyers=[(direct_alice, 0, BUY_WEI)])

        calls = emitted_calls(direct_vm, "record_precedent")
        assert len(calls) == 1, f"settlement must record exactly one precedent, got {calls}"
        call = calls[0]
        assert addr_hex(call["address"]).lower() == FAKE_CHARTER_ADDR.lower()

        args = list(call["calldata"].get("args", []))
        assert len(args) == len(precedent_rules.ARG_ORDER), args
        payload = dict(zip(precedent_rules.ARG_ORDER, args))

        # The emitted arguments are exactly what the published view promises.
        assert payload == json.loads(market.get_precedent_payload(mid))
        # And they are arguments VantageCharter.record_precedent will accept.
        precedent_rules.assert_charter_accepts(payload)

        assert payload["precedent_id"] == f"prec-{mid}"
        assert payload["market_id"] == mid
        assert payload["outcome"] == "Yes"
        assert payload["reason_code"] == "QUORUM_MET"
        assert payload["predicate_type"] == "numeric"
        assert result["precedent_id"] == payload["precedent_id"]

    def test_recorded_pattern_carries_the_locked_comparator(self, market, direct_vm):
        mid, _, _ = _settled(market, direct_vm)
        payload = json.loads(market.get_precedent_payload(mid))
        assert "price_usd gte 5000 USD" in payload["spec_pattern"], payload["spec_pattern"]
        assert precedent_rules.usable_tags(payload["tags_csv"]), payload["tags_csv"]

    def test_market_document_records_the_precedent_id(self, market, direct_vm):
        mid, _, _ = _settled(market, direct_vm)
        settled = json.loads(market.get_market(mid))
        assert settled["precedent_id"] == f"prec-{mid}"
        assert settled["payout_per_share_wei"] == "1"


# ---------------------------------------------------------------------------
# Evidence policy: endpoints, whitelist, spec binding
# ---------------------------------------------------------------------------

class TestEvidencePolicy:
    def test_spec_keeps_the_request_path_and_parameters(self, market, direct_vm):
        mid = _create_market(market, direct_vm)
        spec = json.loads(market.get_spec(mid))
        assert "api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd" in spec["sources"]
        plan = json.loads(market.get_resolution_plan(mid))
        assert any("?ids=ethereum" in e for e in plan["resolution_endpoints"]), plan

    def test_resolution_fetches_the_locked_endpoint_not_the_homepage(self, market, direct_vm):
        mid = _create_market(market, direct_vm, close=now_ts() + 400)
        spec = json.loads(market.get_spec(mid))
        direct_vm.warp("2090-01-01T00:00:00Z")
        market.close_market(mid)
        # Only the exact locked endpoints answer. A fetch of a bare host 404s.
        direct_vm.mock_web(r"https://api\.coingecko\.com/api/v3/simple/price\?ids=ethereum.*",
                           {"status": 200, "body": "price: $6000"})
        direct_vm.mock_web(r"https://api\.github\.com/repos/ethereum/go-ethereum",
                           {"status": 200, "body": "price: $6000"})
        direct_vm.mock_web(r"https://www\.federalreserve\.gov/releases/h15/",
                           {"status": 200, "body": "price: $6000"})
        direct_vm.mock_llm(".*fact extractor.*", _ev_response(spec["spec_hash"], 0, 6000.0))
        result = json.loads(market.resolve(mid))
        assert result["state"] == "PROVISIONAL", result
        assert result["winning_outcome"] == 0

    def test_homepage_only_evidence_cannot_resolve(self, market, direct_vm):
        mid = _create_market(market, direct_vm, close=now_ts() + 400)
        spec = json.loads(market.get_spec(mid))
        direct_vm.warp("2090-01-01T00:00:00Z")
        market.close_market(mid)
        # Nothing but the bare hosts is reachable, so the locked endpoints fail and
        # no quorum forms: proof the path is actually being requested.
        direct_vm.mock_web(r"https://api\.coingecko\.com/?$", {"status": 200, "body": "price: $6000"})
        direct_vm.mock_web(r"https://api\.github\.com/?$", {"status": 200, "body": "price: $6000"})
        direct_vm.mock_llm(".*fact extractor.*", _ev_response(spec["spec_hash"], 0, 6000.0))
        result = json.loads(market.resolve(mid))
        assert result["state"] == "VOID"
        assert result["reason"] == "QUORUM_FAILED"

    def test_off_whitelist_sources_never_reach_the_spec(self, market, direct_vm):
        direct_vm.mock_llm(".*spec compiler.*", OFF_WHITELIST_RESPONSE)
        direct_vm.value = BOND_WEI
        result = json.loads(market.compile_market(
            "Will ETH price exceed $5000 by end of 2025?",
            now_ts() + 7200,
        ))
        # The compiler proposed two hosts the charter never authorized. Neither
        # survives, the charter's own hosts backfill the quorum, and nothing
        # off-whitelist is stored or ever fetched.
        assert result["created"] is True, result
        spec = json.loads(market.get_spec(result["market_id"]))
        hosts = {s.split("/")[0].split("?")[0] for s in spec["sources"]}
        assert "evil.example.com" not in hosts
        assert "pastebin.com" not in hosts
        assert hosts <= set(MOCK_CHARTER["ranked_sources"])
        plan = json.loads(market.get_resolution_plan(result["market_id"]))
        assert set(plan["appeal_hosts"]) <= set(MOCK_CHARTER["ranked_sources"])

    def test_several_paths_on_one_host_collapse_to_one_source(self, market, direct_vm):
        direct_vm.mock_llm(".*spec compiler.*", SINGLE_HOST_RESPONSE)
        direct_vm.value = BOND_WEI
        result = json.loads(market.compile_market(
            "Will ETH price exceed $5000 by end of 2025?",
            now_ts() + 7200,
        ))
        assert result["created"] is True, result
        spec = json.loads(market.get_spec(result["market_id"]))
        hosts = [s.split("/")[0].split("?")[0] for s in spec["sources"]]

        # The compiler offered three coingecko paths. One source is one vote, so
        # only one survives and the quorum is filled from other hosts.
        assert hosts.count("api.coingecko.com") == 1, spec["sources"]
        assert len(set(hosts)) == len(hosts), f"one endpoint per host: {spec['sources']}"
        assert len(set(hosts)) >= spec["quorum_n"]

    def test_spec_hash_binds_units(self, market, direct_vm):
        first = _create_market(market, direct_vm)
        baseline = json.loads(market.get_spec(first))["spec_hash"]

        shifted = json.loads(COMPILE_RESPONSE)
        shifted["units"] = "EUR"
        install_charter_hook(direct_vm)
        direct_vm.mock_llm(".*spec compiler.*", json.dumps(shifted))
        direct_vm.value = BOND_WEI
        created = json.loads(market.compile_market(
            "Will ETH price exceed $5000 by end of 2025?",
            now_ts() + 86400,
        ))
        assert created["created"] is True
        assert json.loads(market.get_spec(created["market_id"]))["spec_hash"] != baseline, (
            "units are material: five could mean dollars or euros"
        )

    def test_spec_hash_binds_the_fact_schema(self, market, direct_vm):
        first = _create_market(market, direct_vm)
        baseline = json.loads(market.get_spec(first))["spec_hash"]

        shifted = json.loads(COMPILE_RESPONSE)
        shifted["fact_schema"] = {"price_usd": "string", "as_of": "string"}
        install_charter_hook(direct_vm)
        direct_vm.mock_llm(".*spec compiler.*", json.dumps(shifted))
        direct_vm.value = BOND_WEI
        created = json.loads(market.compile_market(
            "Will ETH price exceed $5000 by end of 2025?",
            now_ts() + 86400,
        ))
        assert created["created"] is True
        assert json.loads(market.get_spec(created["market_id"]))["spec_hash"] != baseline

    def _disagreeing_validator(self, market, direct_vm, mutate, extra_sources=""):
        """Compile as the leader, then recompile as a validator with one field moved."""
        install_charter_hook(direct_vm)
        direct_vm.mock_llm(".*spec compiler.*", COMPILE_RESPONSE)
        direct_vm.value = BOND_WEI
        market.compile_market(
            "Will ETH price exceed $5000 by end of 2025?",
            now_ts() + 7200,
            "0",
            extra_sources,
        )
        shifted = json.loads(COMPILE_RESPONSE)
        mutate(shifted)
        direct_vm.clear_mocks()
        install_charter_hook(direct_vm)
        direct_vm.mock_llm(".*spec compiler.*", json.dumps(shifted))
        return direct_vm.run_validator()

    def test_validator_rejects_a_different_unit(self, market, direct_vm):
        def mutate(spec):
            spec["units"] = "GBP"
        assert self._disagreeing_validator(market, direct_vm, mutate) is False

    def test_validator_accepts_a_unit_qualifier(self, market, direct_vm):
        # "USD" and "USD per ETH" are the same measurement worded twice.
        def mutate(spec):
            spec["units"] = "USD per ETH"
        assert self._disagreeing_validator(market, direct_vm, mutate) is True

    def test_validator_rejects_reading_a_different_quantity(self, market, direct_vm):
        # Same shape, different number: volume is not price.
        def mutate(spec):
            spec["predicate_field"] = "volume_usd"
            spec["fact_schema"] = {"volume_usd": "number"}
        assert self._disagreeing_validator(market, direct_vm, mutate) is False

    def test_validator_accepts_a_renamed_field_for_the_same_reading(self, market, direct_vm):
        # The field name is a label the compiler invents. eth_usd_price and
        # price_usd are the same number read twice.
        def mutate(spec):
            spec["predicate_field"] = "eth_usd_price"
            spec["fact_schema"] = {"eth_usd_price": "number"}
        assert self._disagreeing_validator(market, direct_vm, mutate) is True

    def test_validator_rejects_a_conflicting_declared_type(self, market, direct_vm):
        # Reading the deciding field as text instead of a number is a disagreement
        # about what the evidence is.
        def mutate(spec):
            spec["fact_schema"] = {"price_usd": "string"}
        assert self._disagreeing_validator(market, direct_vm, mutate) is False

    def test_validator_accepts_a_surplus_context_field(self, market, direct_vm):
        def mutate(spec):
            spec["fact_schema"] = {"price_usd": "number", "as_of": "string"}
        assert self._disagreeing_validator(market, direct_vm, mutate) is True

    def test_validator_accepts_an_equivalent_schema_type(self, market, direct_vm):
        # Same field, same kind of value, different word for the type.
        def mutate(spec):
            spec["fact_schema"] = {"price_usd": "float"}
        assert self._disagreeing_validator(market, direct_vm, mutate) is True

    def test_validator_rejects_a_band_that_excludes_the_threshold(self, market, direct_vm):
        # A band topping out below the threshold would discard the very reading the
        # predicate is about.
        def mutate(spec):
            spec["sanity_max"] = "4000"
        assert self._disagreeing_validator(market, direct_vm, mutate) is False

    def test_validator_rejects_a_disjoint_band(self, market, direct_vm):
        def mutate(spec):
            spec["sanity_min"] = "2000000"
            spec["sanity_max"] = "3000000"
        assert self._disagreeing_validator(market, direct_vm, mutate) is False

    def test_validator_accepts_a_differently_estimated_band(self, market, direct_vm):
        # Two honest estimates of "plausible" differ. Both still admit 5000.
        def mutate(spec):
            spec["sanity_min"] = "0"
            spec["sanity_max"] = "2000000"
        assert self._disagreeing_validator(market, direct_vm, mutate) is True

    def test_validator_rejects_a_disjoint_source_set(self, market, direct_vm):
        # No host in common is no shared evidence at all.
        def mutate(spec):
            spec["sources"] = [
                "api.weather.gov/stations/KNYC/observations/latest",
                "en.wikipedia.org/wiki/Ethereum",
                "www.federalreserve.gov/releases/h15/",
            ]
        assert self._disagreeing_validator(
            market, direct_vm, mutate, extra_sources="api.weather.gov,en.wikipedia.org"
        ) is False

    def test_validator_accepts_one_substituted_source_host(self, market, direct_vm):
        # Two validators each naming three whitelisted hosts out of five should not
        # fail over which third one they picked, as long as a quorum still overlaps.
        def mutate(spec):
            spec["sources"] = [
                "api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
                "api.github.com/repos/ethereum/go-ethereum",
                "en.wikipedia.org/wiki/Ethereum",
            ]
        assert self._disagreeing_validator(
            market, direct_vm, mutate, extra_sources="api.weather.gov,en.wikipedia.org"
        ) is True

    def test_a_short_source_list_is_backfilled_to_the_quorum(self, market, direct_vm):
        # Neither side can propose a thinner evidence base than the charter's
        # quorum: the compiler's list is backfilled from whitelisted hosts, so the
        # host count is the same on every validator.
        shifted = json.loads(COMPILE_RESPONSE)
        shifted["sources"] = ["api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd"]
        install_charter_hook(direct_vm)
        direct_vm.mock_llm(".*spec compiler.*", json.dumps(shifted))
        direct_vm.value = BOND_WEI
        created = json.loads(market.compile_market(
            "Will ETH price exceed $5000 by end of 2025?",
            now_ts() + 7200,
        ))
        assert created["created"] is True, created
        spec = json.loads(market.get_spec(created["market_id"]))
        hosts = [s.split("/")[0].split("?")[0] for s in spec["sources"]]
        assert len(hosts) == spec["quorum_n"] == MOCK_CHARTER["default_quorum_n"]
        assert len(set(hosts)) == len(hosts)
        assert hosts[0] == "api.coingecko.com"

    def test_validator_accepts_a_different_path_on_the_same_hosts(self, market, direct_vm):
        # Two validators may reach the same price through differently parameterized
        # endpoints. The hosts are what the quorum is a claim about, and the leader's
        # endpoints are what the spec hash locks for the resolution pass.
        def mutate(spec):
            spec["sources"] = [
                "api.coingecko.com/api/v3/coins/ethereum?market_data=true",
                "api.github.com/repos/ethereum/go-ethereum/releases",
                "www.federalreserve.gov/releases/h15/default.htm",
            ]
        assert self._disagreeing_validator(market, direct_vm, mutate) is True

    def test_validator_rejects_a_different_predicate(self, market, direct_vm):
        def mutate(spec):
            spec["predicate"] = "Solana staking yield is under four percent on the settlement date"
        assert self._disagreeing_validator(market, direct_vm, mutate) is False

    def test_validator_accepts_reworded_prose(self, market, direct_vm):
        def mutate(spec):
            spec["restated_question"] = "Is the ETH/USD price at or above 5000 USD by the close?"
            spec["predicate"] = "ETH/USD price is above 5000 at the close time"
        assert self._disagreeing_validator(market, direct_vm, mutate) is True

    def test_validator_accepts_a_more_verbose_predicate(self, market, direct_vm):
        # A validator that spells the same condition out at length still agrees:
        # containment, not equal verbosity.
        def mutate(spec):
            spec["predicate"] = (
                "Resolve Yes if the ETH/USD price is above 5000 at close time according to "
                "matching readings from at least two of the three listed independent sources, "
                "otherwise resolve No; if fewer than two sources report a usable figure for "
                "that timestamp the market voids under the house rules"
            )
        assert self._disagreeing_validator(market, direct_vm, mutate) is True


# ---------------------------------------------------------------------------
# Numeric verdicts derived from the locked comparator
# ---------------------------------------------------------------------------

class TestNumericDerivation:
    def _resolve_with(self, market, direct_vm, value, model_index, outcomes=None):
        compiled = json.loads(COMPILE_RESPONSE)
        if outcomes is not None:
            compiled["outcomes"] = outcomes
        install_charter_hook(direct_vm)
        direct_vm.mock_llm(".*spec compiler.*", json.dumps(compiled))
        direct_vm.value = BOND_WEI
        created = json.loads(market.compile_market(
            "Will ETH price exceed $5000 by end of 2025?",
            now_ts() + 400,
        ))
        assert created["created"] is True, created
        mid = created["market_id"]
        spec = json.loads(market.get_spec(mid))
        direct_vm.clear_mocks()
        install_charter_hook(direct_vm)
        direct_vm.warp("2090-01-01T00:00:00Z")
        market.close_market(mid)
        direct_vm.mock_web(".*", {"status": 200, "body": f"price: {value}"})
        direct_vm.mock_llm(".*fact extractor.*", _ev_response(spec["spec_hash"], model_index, value))
        return mid, json.loads(market.resolve(mid))

    def test_contract_overrules_the_model_on_the_outcome(self, market, direct_vm):
        # The model says "No" while handing back a number that clears the threshold.
        # gte 5000 is locked in the spec, so the contract decides, not the model.
        _, result = self._resolve_with(market, direct_vm, 6000.0, model_index=1)
        assert result["state"] == "PROVISIONAL"
        assert result["winning_outcome"] == 0
        assert result["outcome_label"] == "Yes"

    def test_contract_overrules_the_model_the_other_way(self, market, direct_vm):
        _, result = self._resolve_with(market, direct_vm, 3000.0, model_index=0)
        assert result["state"] == "PROVISIONAL"
        assert result["winning_outcome"] == 1
        assert result["outcome_label"] == "No"

    def test_threshold_boundary_counts_as_met_for_gte(self, market, direct_vm):
        _, result = self._resolve_with(market, direct_vm, 5000.0, model_index=1)
        assert result["winning_outcome"] == 0

    def test_inverted_outcome_labels_are_not_silently_flipped(self, market, direct_vm):
        _, result = self._resolve_with(market, direct_vm, 6000.0, model_index=0, outcomes=["No", "Yes"])
        assert result["state"] == "PROVISIONAL"
        assert result["outcome_label"] == "Yes", result

    def test_value_outside_the_sanity_band_is_discarded(self, market, direct_vm):
        # sanity_max is 1000000, so this reading is thrown away rather than believed.
        _, result = self._resolve_with(market, direct_vm, 99000000.0, model_index=0)
        assert result["state"] == "VOID"
        assert result["reason"] == "QUORUM_FAILED"

    def test_unparseable_value_is_discarded(self, market, direct_vm):
        compiled = json.loads(COMPILE_RESPONSE)
        install_charter_hook(direct_vm)
        direct_vm.mock_llm(".*spec compiler.*", json.dumps(compiled))
        direct_vm.value = BOND_WEI
        created = json.loads(market.compile_market(
            "Will ETH price exceed $5000 by end of 2025?",
            now_ts() + 400,
        ))
        mid = created["market_id"]
        spec = json.loads(market.get_spec(mid))
        direct_vm.clear_mocks()
        install_charter_hook(direct_vm)
        direct_vm.warp("2090-01-01T00:00:00Z")
        market.close_market(mid)
        direct_vm.mock_web(".*", {"status": 200, "body": "price: unavailable"})
        direct_vm.mock_llm(".*fact extractor.*", json.dumps({
            "spec_hash": spec["spec_hash"],
            "found": True,
            "extracted_value": "not a number",
            "outcome_index": 0,
            "fact": {},
        }))
        result = json.loads(market.resolve(mid))
        assert result["state"] == "VOID"

    def test_numeric_market_needs_a_numeric_threshold(self, market, direct_vm):
        compiled = json.loads(COMPILE_RESPONSE)
        compiled["threshold"] = "quite high"
        install_charter_hook(direct_vm)
        direct_vm.mock_llm(".*spec compiler.*", json.dumps(compiled))
        direct_vm.value = BOND_WEI
        result = json.loads(market.compile_market(
            "Will ETH price exceed quite a lot by end of 2025?",
            now_ts() + 7200,
        ))
        assert result["created"] is False
        assert any("parse as a number" in p for p in result["problems"]), result["problems"]

    def test_numeric_market_needs_the_field_in_its_schema(self, market, direct_vm):
        compiled = json.loads(COMPILE_RESPONSE)
        compiled["fact_schema"] = {"something_else": "number"}
        install_charter_hook(direct_vm)
        direct_vm.mock_llm(".*spec compiler.*", json.dumps(compiled))
        direct_vm.value = BOND_WEI
        result = json.loads(market.compile_market(
            "Will ETH price exceed $5000 by end of 2025?",
            now_ts() + 7200,
        ))
        assert result["created"] is False
        assert any("fact schema" in p for p in result["problems"]), result["problems"]


# ---------------------------------------------------------------------------
# Quorum independence and appeal widening
# ---------------------------------------------------------------------------

class TestQuorumIndependence:
    def test_appeal_sources_are_distinct_and_wider(self, market, direct_vm):
        mid = _create_market(market, direct_vm)
        plan = json.loads(market.get_resolution_plan(mid))

        appeal_hosts = plan["appeal_hosts"]
        assert len(appeal_hosts) == len(set(appeal_hosts)), f"duplicate appeal hosts: {appeal_hosts}"
        assert len(plan["appeal_endpoints"]) == len(appeal_hosts), (
            "an appeal must be one endpoint per host, never the same host twice"
        )
        assert set(plan["resolution_hosts"]) <= set(appeal_hosts)
        assert len(appeal_hosts) >= len(plan["resolution_hosts"])
        for host in appeal_hosts:
            assert host in plan["allowed_hosts"], host

    def test_appeal_reaches_for_hosts_the_first_pass_did_not_use(self, market, direct_vm):
        install_charter_hook(direct_vm)
        direct_vm.mock_llm(".*spec compiler.*", COMPILE_RESPONSE)
        direct_vm.value = BOND_WEI
        created = json.loads(market.compile_market(
            "Will ETH price exceed $5000 by end of 2025?",
            now_ts() + 86400,
            "0",
            "api.weather.gov,en.wikipedia.org",
        ))
        assert created["created"] is True, created
        plan = json.loads(market.get_resolution_plan(created["market_id"]))

        assert len(plan["appeal_hosts"]) > len(plan["resolution_hosts"]), plan
        assert set(plan["resolution_hosts"]) < set(plan["appeal_hosts"])
        assert "api.weather.gov" in plan["appeal_hosts"]
        assert len(plan["appeal_hosts"]) == len(set(plan["appeal_hosts"]))

    def test_one_host_cannot_satisfy_the_appeal_quorum(self, market, direct_vm, direct_bob):
        mid, spec_hash = _resolved_market(market, direct_vm)
        with direct_vm.prank(direct_bob):
            direct_vm.value = APPEAL_BOND_WEI
            market.appeal(mid)

        # Exactly one host answers, and it answers every time it is asked. With
        # k=2 that still has to fail, because votes are counted per host.
        direct_vm.mock_web(r"https://api\.coingecko\.com/.*", {"status": 200, "body": "price: $6000"})
        direct_vm.mock_llm(".*fact extractor.*", _ev_response(spec_hash, 0, 6000.0))
        result = json.loads(market.resolve_appeal(mid))
        assert result["state"] == "VOID", result
        assert result["reason"] == "QUORUM_FAILED"

    def test_two_hosts_do_satisfy_the_appeal_quorum(self, market, direct_vm, direct_bob):
        mid, spec_hash = _resolved_market(market, direct_vm)
        with direct_vm.prank(direct_bob):
            direct_vm.value = APPEAL_BOND_WEI
            market.appeal(mid)

        direct_vm.mock_web(r"https://api\.coingecko\.com/.*", {"status": 200, "body": "price: $6000"})
        direct_vm.mock_web(r"https://api\.github\.com/.*", {"status": 200, "body": "price: $6000"})
        direct_vm.mock_llm(".*fact extractor.*", _ev_response(spec_hash, 0, 6000.0))
        result = json.loads(market.resolve_appeal(mid))
        assert result["state"] == "PROVISIONAL", result
        assert result["winner"] == 0


# ---------------------------------------------------------------------------
# Challenge evidence under the same source policy
# ---------------------------------------------------------------------------

def _resolved_market(market, direct_vm, outcome_index=0, value=6000.0):
    mid = _create_market(market, direct_vm, close=now_ts() + 400)
    spec = json.loads(market.get_spec(mid))
    spec_hash = spec["spec_hash"]
    direct_vm.warp("2090-01-01T00:00:00Z")
    market.close_market(mid)
    direct_vm.mock_web(".*", {"status": 200, "body": "price: $6000"})
    direct_vm.mock_llm(".*fact extractor.*", _ev_response(spec_hash, outcome_index, value))
    market.resolve(mid)
    direct_vm.clear_mocks()
    install_charter_hook(direct_vm)
    return mid, spec_hash


class TestChallengeEvidencePolicy:
    def test_challenge_rejects_an_off_whitelist_host(self, market, direct_vm, direct_alice):
        mid, _ = _resolved_market(market, direct_vm)
        with direct_vm.prank(direct_alice):
            direct_vm.value = CHALLENGE_BOND_WEI
            with direct_vm.expect_revert("[EXPECTED]"):
                market.challenge(mid, "pastebin.com/raw/whatever")

    def test_challenge_rejects_a_malformed_evidence_url(self, market, direct_vm, direct_alice):
        mid, _ = _resolved_market(market, direct_vm)
        with direct_vm.prank(direct_alice):
            direct_vm.value = CHALLENGE_BOND_WEI
            with direct_vm.expect_revert("[EXPECTED]"):
                market.challenge(mid, "not a url at all")

    def test_challenge_rejects_credentials_smuggled_into_the_host(
        self, market, direct_vm, direct_alice
    ):
        mid, _ = _resolved_market(market, direct_vm)
        with direct_vm.prank(direct_alice):
            direct_vm.value = CHALLENGE_BOND_WEI
            with direct_vm.expect_revert("[EXPECTED]"):
                market.challenge(mid, "api.coingecko.com@evil.example.com/price")

    def test_challenge_keeps_the_evidence_path(self, market, direct_vm, direct_alice):
        mid, _ = _resolved_market(market, direct_vm)
        with direct_vm.prank(direct_alice):
            direct_vm.value = CHALLENGE_BOND_WEI
            result = json.loads(market.challenge(
                mid,
                "https://api.coingecko.com/api/v3/coins/ethereum/history?date=31-12-2025",
            ))
        assert result["state"] == "CHALLENGED"
        expected = "api.coingecko.com/api/v3/coins/ethereum/history?date=31-12-2025"
        assert result["evidence_url"] == expected
        contest = json.loads(market.get_contest(mid))
        assert contest["evidence_url"] == expected
        assert contest["evidence_host"] == "api.coingecko.com"

    def test_challenge_evidence_is_judged_by_the_same_extractor(
        self, market, direct_vm, direct_alice
    ):
        mid, spec_hash = _resolved_market(market, direct_vm)
        with direct_vm.prank(direct_alice):
            direct_vm.value = CHALLENGE_BOND_WEI
            market.challenge(mid, "api.coingecko.com/api/v3/coins/ethereum/history?date=31-12-2025")

        # Contrary evidence: the number is below the threshold everywhere, so the
        # same derivation that produced "Yes" now produces "No".
        direct_vm.mock_web(".*", {"status": 200, "body": "price: $3000"})
        direct_vm.mock_llm(".*fact extractor.*", _ev_response(spec_hash, 0, 3000.0))
        result = json.loads(market.resolve_challenge(mid))
        assert result["state"] == "PROVISIONAL"
        assert result["upheld"] is True, result
        assert result["new_winner"] == 1
        assert int(result["challenger_reward_wei"]) >= CHALLENGE_BOND_WEI

    def test_challenge_evidence_on_a_known_host_cannot_vote_twice(
        self, market, direct_vm, direct_alice
    ):
        mid, spec_hash = _resolved_market(market, direct_vm)
        with direct_vm.prank(direct_alice):
            direct_vm.value = CHALLENGE_BOND_WEI
            market.challenge(mid, "api.coingecko.com/api/v3/coins/ethereum")

        # Only the challenger's host answers. One host is one vote, so k=2 fails
        # and the original verdict stands.
        direct_vm.mock_web(r"https://api\.coingecko\.com/.*", {"status": 200, "body": "price: $3000"})
        direct_vm.mock_llm(".*fact extractor.*", _ev_response(spec_hash, 1, 3000.0))
        result = json.loads(market.resolve_challenge(mid))
        assert result["upheld"] is False, result
        assert result["winner"] == 0


# ---------------------------------------------------------------------------
# Relayed writes keep the user as the on-chain principal
# ---------------------------------------------------------------------------

class TestRelayedActor:
    def test_relayed_compile_keeps_the_user_as_author(self, market, direct_vm, direct_alice):
        install_charter_hook(direct_vm)
        direct_vm.mock_llm(".*spec compiler.*", COMPILE_RESPONSE)
        direct_vm.value = BOND_WEI + SEED_WEI
        created = json.loads(market.compile_market(
            "Will ETH price exceed $5000 by end of 2025?",
            now_ts() + 86400,
            str(SEED_WEI),
            "",
            "",
            "",
            addr_hex(direct_alice),
        ))
        assert created["created"] is True
        assert created["author"].lower() == addr_hex(direct_alice).lower()

        m = json.loads(market.get_market(created["market_id"]))
        assert m["author"].lower() == addr_hex(direct_alice).lower()
        # The seed liquidity is the author's position, not the relayer's.
        pos = json.loads(market.get_position(created["market_id"], addr_hex(direct_alice)))
        assert int(pos["lp_shares"]) == SEED_WEI

    def test_relayed_buy_credits_the_user_not_the_relayer(
        self, market, direct_vm, direct_alice, direct_owner
    ):
        mid = _create_market(market, direct_vm)
        direct_vm.value = BUY_WEI
        result = json.loads(market.buy(mid, 0, "0", addr_hex(direct_alice)))
        assert result["holder"].lower() == addr_hex(direct_alice).lower()

        alice = json.loads(market.get_position(mid, addr_hex(direct_alice)))
        relayer = json.loads(market.get_position(mid, addr_hex(direct_owner)))
        assert int(alice["shares"]["0"]) == int(result["shares_out"])
        assert int(relayer["shares"].get("0", "0")) == 0
        assert mid in json.loads(market.get_markets_for_trader(addr_hex(direct_alice)))["market_ids"]

    def test_relayed_sell_debits_the_user(self, market, direct_vm, direct_alice):
        mid = _create_market(market, direct_vm)
        direct_vm.value = BUY_WEI
        bought = int(json.loads(market.buy(mid, 0, "0", addr_hex(direct_alice)))["shares_out"])
        sold = json.loads(market.sell(mid, 0, str(bought // 2), "0", addr_hex(direct_alice)))
        assert sold["holder"].lower() == addr_hex(direct_alice).lower()

        remaining = int(json.loads(market.get_position(mid, addr_hex(direct_alice)))["shares"]["0"])
        assert remaining == bought - bought // 2
        # The sale proceeds are the user's credit.
        assert int(json.loads(market.get_balance(addr_hex(direct_alice)))["balance_wei"]) == int(
            sold["collateral_out"]
        )

    def test_relayed_bond_refund_goes_to_the_user(self, market, direct_vm, direct_alice):
        direct_vm.mock_llm(".*spec compiler.*", UNRESOLVABLE_RESPONSE)
        direct_vm.value = BOND_WEI
        result = json.loads(market.compile_market(
            "Will it rain tomorrow somewhere in the world?",
            now_ts() + 7200,
            "0",
            "",
            "",
            "",
            addr_hex(direct_alice),
        ))
        assert result["created"] is False
        assert int(json.loads(market.get_balance(addr_hex(direct_alice)))["balance_wei"]) == BOND_WEI

    def test_relayed_challenge_bonds_the_user(self, market, direct_vm, direct_alice):
        mid, _ = _resolved_market(market, direct_vm)
        direct_vm.value = CHALLENGE_BOND_WEI
        result = json.loads(market.challenge(
            mid,
            "api.coingecko.com/api/v3/coins/ethereum",
            addr_hex(direct_alice),
        ))
        assert result["challenger"].lower() == addr_hex(direct_alice).lower()
        assert json.loads(market.get_contest(mid))["challenger"].lower() == addr_hex(direct_alice).lower()

    def test_relayed_appeal_bonds_the_user(self, market, direct_vm, direct_bob):
        mid, _ = _resolved_market(market, direct_vm)
        direct_vm.value = APPEAL_BOND_WEI
        result = json.loads(market.appeal(mid, addr_hex(direct_bob)))
        assert result["appellant"].lower() == addr_hex(direct_bob).lower()

    def test_relayed_withdraw_pays_the_user(self, market, direct_vm, direct_alice):
        mid = _create_market(market, direct_vm)
        direct_vm.value = BUY_WEI
        bought = int(json.loads(market.buy(mid, 0, "0", addr_hex(direct_alice)))["shares_out"])
        market.sell(mid, 0, str(bought // 2), "0", addr_hex(direct_alice))
        owed = int(json.loads(market.get_balance(addr_hex(direct_alice)))["balance_wei"])
        assert owed > 0

        reset_messages(direct_vm)
        payout = json.loads(market.withdraw(addr_hex(direct_alice)))
        assert int(payout["withdrawn_wei"]) == owed
        assert payout["payee"].lower() == addr_hex(direct_alice).lower()

        transfers = emitted_transfers(direct_vm)
        assert len(transfers) == 1, transfers
        assert addr_hex(transfers[0]["address"]).lower() == addr_hex(direct_alice).lower()
        assert int(transfers[0]["value"]) == owed
        assert int(json.loads(market.get_balance(addr_hex(direct_alice)))["balance_wei"]) == 0

    def test_a_stranger_cannot_act_for_someone_else(
        self, market, direct_vm, direct_alice, direct_bob
    ):
        mid = _create_market(market, direct_vm)
        with direct_vm.prank(direct_alice):
            direct_vm.value = BUY_WEI
            with direct_vm.expect_revert("[EXPECTED]"):
                market.buy(mid, 0, "0", addr_hex(direct_bob))

    def test_naming_yourself_is_always_allowed(self, market, direct_vm, direct_alice):
        mid = _create_market(market, direct_vm)
        with direct_vm.prank(direct_alice):
            direct_vm.value = BUY_WEI
            result = json.loads(market.buy(mid, 0, "0", addr_hex(direct_alice)))
        assert int(result["shares_out"]) > 0

    def test_a_malformed_actor_is_rejected(self, market, direct_vm):
        mid = _create_market(market, direct_vm)
        direct_vm.value = BUY_WEI
        with direct_vm.expect_revert("[EXPECTED]"):
            market.buy(mid, 0, "0", "alice@example.com")

    def test_owner_can_authorize_and_revoke_a_relayer(
        self, market, direct_vm, direct_alice, direct_bob, direct_owner
    ):
        mid = _create_market(market, direct_vm)
        assert market.is_relayer(addr_hex(direct_alice)) is False

        with direct_vm.prank(direct_owner):
            market.set_relayer(addr_hex(direct_alice), True)
        assert market.is_relayer(addr_hex(direct_alice)) is True

        with direct_vm.prank(direct_alice):
            direct_vm.value = BUY_WEI
            result = json.loads(market.buy(mid, 0, "0", addr_hex(direct_bob)))
        assert result["holder"].lower() == addr_hex(direct_bob).lower()

        with direct_vm.prank(direct_owner):
            market.set_relayer(addr_hex(direct_alice), False)
        assert market.is_relayer(addr_hex(direct_alice)) is False
        with direct_vm.prank(direct_alice):
            direct_vm.value = BUY_WEI
            with direct_vm.expect_revert("[EXPECTED]"):
                market.buy(mid, 0, "0", addr_hex(direct_bob))

    def test_set_relayer_is_owner_only(self, market, direct_vm, direct_alice):
        with direct_vm.prank(direct_alice):
            with direct_vm.expect_revert("[EXPECTED]"):
                market.set_relayer(addr_hex(direct_alice), True)

    def test_settlement_pays_the_relayed_holder(self, market, direct_vm, direct_alice):
        mid = _create_market(market, direct_vm, close=now_ts() + 400)
        direct_vm.value = BUY_WEI
        shares = int(json.loads(market.buy(mid, 0, "0", addr_hex(direct_alice)))["shares_out"])

        spec = json.loads(market.get_spec(mid))
        direct_vm.warp("2090-01-01T00:00:00Z")
        market.close_market(mid)
        direct_vm.mock_web(".*", {"status": 200, "body": "price: $6000"})
        direct_vm.mock_llm(".*fact extractor.*", _ev_response(spec["spec_hash"], 0, 6000.0))
        market.resolve(mid)
        direct_vm.clear_mocks()
        install_charter_hook(direct_vm)
        direct_vm.warp("2090-01-05T00:00:00Z")
        market.finalize(mid)
        market.settle(mid)

        # The position was the user's, so the payout is the user's too.
        assert int(json.loads(market.get_balance(addr_hex(direct_alice)))["balance_wei"]) == shares
