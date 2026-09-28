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


def install_charter_hook(direct_vm):
    """
    Install a _gl_call_hook that intercepts CallContract requests to the charter
    address and returns mocked sub-VM calldata-encoded responses (code 0 + calldata).
    """
    def hook(vm, request):
        if "PostMessage" in request:
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
    "sources": ["api.coingecko.com", "api.github.com", "www.federalreserve.gov"],
    "tags": ["ethereum", "crypto", "price", "threshold"],
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
        direct_vm.mock_llm(".*Re-examine.*", contrary)
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
