"""
tests/direct/test_charter.py
============================

Direct-mode unit tests for VantageCharter.

Uses gltest.direct fixtures: direct_deploy, direct_owner, direct_alice, direct_bob.
All nondet and cross-contract calls are mocked at the VMContext level.
"""

import json
import pytest

import precedent_rules

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

CHARTER_PATH = "contracts/vantage_charter.py"

DEFAULT_SOURCES = "api.github.com,api.coingecko.com,www.federalreserve.gov"


def addr_hex(addr) -> str:
    """Convert a gltest Address (raw bytes) to a '0x...' 42-char hex string."""
    return "0x" + bytes(addr).hex()


def deploy_charter(direct_deploy, **kwargs):
    defaults = dict(
        ranked_sources_csv=DEFAULT_SOURCES,
        timezone_name="UTC",
        tie_handling="VOID",
        default_quorum_k=2,
        default_quorum_n=3,
        ambiguity_policy="VOID_AND_SLASH_AUTHOR",
        challenge_window_seconds=3600,
        appeal_window_seconds=3600,
        grace_period_seconds=86400,
        numeric_tolerance_bps=50,
        dual_run_threshold_wei="50000000000000000000",
    )
    defaults.update(kwargs)
    return direct_deploy(CHARTER_PATH, **defaults)


# ---------------------------------------------------------------------------
# Deployment
# ---------------------------------------------------------------------------


class TestCharterDeployment:
    def test_deploys_with_default_args(self, direct_deploy):
        contract = deploy_charter(direct_deploy)
        raw = contract.get_active_charter()
        body = json.loads(raw)
        assert body["version"] == "v1"
        assert body["tie_handling"] == "VOID"
        assert body["default_quorum_k"] == 2
        assert body["default_quorum_n"] == 3

    def test_active_version_is_v1(self, direct_deploy):
        contract = deploy_charter(direct_deploy)
        assert contract.get_active_version() == "v1"

    def test_registry_stats_initial(self, direct_deploy):
        contract = deploy_charter(direct_deploy)
        stats = json.loads(contract.get_registry_stats())
        assert stats["charter_count"] == 1
        assert stats["total_precedents"] == 0
        assert stats["active_version"] == "v1"

    def test_source_rank_known(self, direct_deploy):
        contract = deploy_charter(direct_deploy)
        rank = contract.get_source_rank("v1", "api.github.com")
        assert rank == 0
        rank2 = contract.get_source_rank("v1", "api.coingecko.com")
        assert rank2 == 1

    def test_source_rank_unknown(self, direct_deploy):
        contract = deploy_charter(direct_deploy)
        assert contract.get_source_rank("v1", "www.evil.com") == -1

    def test_deploy_fails_bad_quorum(self, direct_deploy, direct_vm):
        with direct_vm.expect_revert("[EXPECTED]"):
            deploy_charter(direct_deploy, default_quorum_k=5, default_quorum_n=3)

    def test_deploy_fails_bad_tie(self, direct_deploy, direct_vm):
        with direct_vm.expect_revert("[EXPECTED]"):
            deploy_charter(direct_deploy, tie_handling="FLIP_A_COIN")

    def test_deploy_fails_grace_too_short(self, direct_deploy, direct_vm):
        with direct_vm.expect_revert("[EXPECTED]"):
            deploy_charter(
                direct_deploy,
                challenge_window_seconds=86400,
                appeal_window_seconds=86400,
                grace_period_seconds=100,
            )

    def test_deploy_fails_one_source(self, direct_deploy, direct_vm):
        with direct_vm.expect_revert("[EXPECTED]"):
            deploy_charter(
                direct_deploy,
                ranked_sources_csv="api.github.com,api.coingecko.com",
                default_quorum_n=3,
            )


# ---------------------------------------------------------------------------
# Charter versioning
# ---------------------------------------------------------------------------


class TestCharterVersioning:
    def test_publish_second_version(self, direct_deploy, direct_owner, direct_vm):
        contract = deploy_charter(direct_deploy)
        with direct_vm.prank(direct_owner):
            contract.publish_charter(
                "v2",
                DEFAULT_SOURCES + ",en.wikipedia.org",
                "UTC",
                "VOID",
                2,
                3,
                "VOID_AND_SLASH_AUTHOR",
                3600,
                3600,
                86400,
                50,
                "0",
            )
        listing = json.loads(contract.list_charter_versions())
        assert "v2" in listing["versions"]
        assert listing["active"] == "v2"

    def test_version_is_immutable(self, direct_deploy, direct_owner, direct_vm):
        contract = deploy_charter(direct_deploy)
        with direct_vm.prank(direct_owner):
            with direct_vm.expect_revert("[EXPECTED]"):
                contract.publish_charter(
                    "v1",
                    DEFAULT_SOURCES,
                    "UTC",
                    "VOID",
                    2,
                    3,
                    "VOID_AND_SLASH_AUTHOR",
                    3600,
                    3600,
                    86400,
                    50,
                    "0",
                )

    def test_set_active_version(self, direct_deploy, direct_owner, direct_vm):
        contract = deploy_charter(direct_deploy)
        with direct_vm.prank(direct_owner):
            contract.publish_charter(
                "v2",
                DEFAULT_SOURCES + ",en.wikipedia.org",
                "UTC",
                "VOID",
                2,
                3,
                "VOID_AND_SLASH_AUTHOR",
                3600,
                3600,
                86400,
                50,
                "0",
            )
            contract.set_active_version("v1")
        assert contract.get_active_version() == "v1"

    def test_set_nonexistent_version_fails(self, direct_deploy, direct_owner, direct_vm):
        contract = deploy_charter(direct_deploy)
        with direct_vm.prank(direct_owner):
            with direct_vm.expect_revert("[EXPECTED]"):
                contract.set_active_version("v99")

    def test_publish_charter_non_owner_fails(self, direct_deploy, direct_alice, direct_vm):
        contract = deploy_charter(direct_deploy)
        with direct_vm.prank(direct_alice):
            with direct_vm.expect_revert("[EXPECTED]"):
                contract.publish_charter(
                    "v2",
                    DEFAULT_SOURCES,
                    "UTC",
                    "VOID",
                    2,
                    3,
                    "VOID_AND_SLASH_AUTHOR",
                    3600,
                    3600,
                    86400,
                    50,
                    "0",
                )


# ---------------------------------------------------------------------------
# Registrar management
# ---------------------------------------------------------------------------


class TestRegistrars:
    def test_authorize_registrar(self, direct_deploy, direct_owner, direct_alice, direct_vm):
        contract = deploy_charter(direct_deploy)
        with direct_vm.prank(direct_owner):
            contract.authorize_registrar(addr_hex(direct_alice))
        assert contract.is_registrar(addr_hex(direct_alice)) is True

    def test_revoke_registrar(self, direct_deploy, direct_owner, direct_alice, direct_vm):
        contract = deploy_charter(direct_deploy)
        with direct_vm.prank(direct_owner):
            contract.authorize_registrar(addr_hex(direct_alice))
            contract.revoke_registrar(addr_hex(direct_alice))
        assert contract.is_registrar(addr_hex(direct_alice)) is False

    def test_authorize_non_owner_fails(self, direct_deploy, direct_alice, direct_vm):
        contract = deploy_charter(direct_deploy)
        with direct_vm.prank(direct_alice):
            with direct_vm.expect_revert("[EXPECTED]"):
                contract.authorize_registrar(addr_hex(direct_alice))

    def test_list_registrars(self, direct_deploy, direct_owner, direct_alice, direct_bob, direct_vm):
        contract = deploy_charter(direct_deploy)
        with direct_vm.prank(direct_owner):
            contract.authorize_registrar(addr_hex(direct_alice))
            contract.authorize_registrar(addr_hex(direct_bob))
        result = json.loads(contract.list_registrars())
        assert result["count"] == 2
        assert addr_hex(direct_alice) in result["registrars"]


# ---------------------------------------------------------------------------
# Precedent registry
# ---------------------------------------------------------------------------


class TestPrecedentRegistry:
    def _record(self, contract, direct_vm, caller, **overrides):
        defaults = dict(
            precedent_id="prec-001",
            market_id="vm1-abc123",
            spec_pattern="Will Bitcoin exceed $100k before end of 2025?",
            tags_csv="bitcoin,crypto,price,threshold",
            outcome="No",
            reason_code="QUORUM_MET",
            predicate_type="numeric",
            charter_version="v1",
            ruling_note="Three sources agreed price was below threshold at close time.",
        )
        defaults.update(overrides)
        with direct_vm.prank(caller):
            return contract.record_precedent(**defaults)

    def test_record_precedent(self, direct_deploy, direct_owner, direct_vm):
        contract = deploy_charter(direct_deploy)
        raw = self._record(contract, direct_vm, direct_owner)
        record = json.loads(raw)
        assert record["precedent_id"] == "prec-001"
        assert record["reason_code"] == "QUORUM_MET"
        assert record["predicate_type"] == "numeric"
        assert record["sequence"] == 1

    def test_duplicate_precedent_fails(self, direct_deploy, direct_owner, direct_vm):
        contract = deploy_charter(direct_deploy)
        self._record(contract, direct_vm, direct_owner)
        with direct_vm.prank(direct_owner):
            with direct_vm.expect_revert("[EXPECTED]"):
                contract.record_precedent(
                    precedent_id="prec-001",
                    market_id="vm1-abc123",
                    spec_pattern="Will Bitcoin exceed $100k before end of 2025?",
                    tags_csv="bitcoin,crypto",
                    outcome="No",
                    reason_code="QUORUM_MET",
                    predicate_type="numeric",
                    charter_version="v1",
                )

    def test_lookup_by_tag(self, direct_deploy, direct_owner, direct_vm):
        contract = deploy_charter(direct_deploy)
        self._record(contract, direct_vm, direct_owner)
        result = json.loads(contract.lookup_by_tag("bitcoin"))
        assert result["count"] == 1
        assert result["matches"][0]["precedent_id"] == "prec-001"

    def test_lookup_for_spec(self, direct_deploy, direct_owner, direct_vm):
        contract = deploy_charter(direct_deploy)
        self._record(contract, direct_vm, direct_owner)
        result = json.loads(contract.lookup_for_spec("bitcoin,crypto"))
        assert result["count"] == 1
        assert result["matches"][0]["tag_overlap"] == 2

    def test_lookup_for_spec_no_match(self, direct_deploy, direct_owner, direct_vm):
        contract = deploy_charter(direct_deploy)
        self._record(contract, direct_vm, direct_owner)
        result = json.loads(contract.lookup_for_spec("football,sports"))
        assert result["count"] == 0

    def test_get_precedents_for_market(self, direct_deploy, direct_owner, direct_vm):
        contract = deploy_charter(direct_deploy)
        self._record(contract, direct_vm, direct_owner)
        result = json.loads(contract.get_precedents_for_market("vm1-abc123"))
        assert result["count"] == 1

    def test_unknown_reason_code_fails(self, direct_deploy, direct_owner, direct_vm):
        contract = deploy_charter(direct_deploy)
        with direct_vm.prank(direct_owner):
            with direct_vm.expect_revert("[EXPECTED]"):
                contract.record_precedent(
                    precedent_id="prec-bad",
                    market_id="vm1-abc123",
                    spec_pattern="Will Bitcoin exceed $100k before end of 2025?",
                    tags_csv="bitcoin",
                    outcome="No",
                    reason_code="MADE_UP",
                    predicate_type="numeric",
                    charter_version="v1",
                )

    def test_unknown_predicate_type_fails(self, direct_deploy, direct_owner, direct_vm):
        contract = deploy_charter(direct_deploy)
        with direct_vm.prank(direct_owner):
            with direct_vm.expect_revert("[EXPECTED]"):
                contract.record_precedent(
                    precedent_id="prec-bad2",
                    market_id="vm1-abc123",
                    spec_pattern="Will Bitcoin exceed $100k before end of 2025?",
                    tags_csv="bitcoin",
                    outcome="No",
                    reason_code="QUORUM_MET",
                    predicate_type="vibes",
                    charter_version="v1",
                )

    def test_unauthorized_record_fails(self, direct_deploy, direct_alice, direct_vm):
        contract = deploy_charter(direct_deploy)
        with direct_vm.prank(direct_alice):
            with direct_vm.expect_revert("[EXPECTED]"):
                contract.record_precedent(
                    precedent_id="prec-unauth",
                    market_id="vm1-abc123",
                    spec_pattern="Will X exceed Y by some date here?",
                    tags_csv="test,tag",
                    outcome="Yes",
                    reason_code="QUORUM_MET",
                    predicate_type="event",
                    charter_version="v1",
                )

    def test_authorized_registrar_can_record(self, direct_deploy, direct_owner, direct_alice, direct_vm):
        contract = deploy_charter(direct_deploy)
        with direct_vm.prank(direct_owner):
            contract.authorize_registrar(addr_hex(direct_alice))
        with direct_vm.prank(direct_alice):
            raw = contract.record_precedent(
                precedent_id="prec-reg",
                market_id="vm1-xyz",
                spec_pattern="Some spec pattern here for test case",
                tags_csv="test,tag",
                outcome="Yes",
                reason_code="QUORUM_MET",
                predicate_type="event",
                charter_version="v1",
            )
        record = json.loads(raw)
        assert record["recorded_by"].lower() == addr_hex(direct_alice).lower()

    def test_list_tags(self, direct_deploy, direct_owner, direct_vm):
        contract = deploy_charter(direct_deploy)
        self._record(contract, direct_vm, direct_owner)
        result = json.loads(contract.list_tags())
        tag_names = [t["tag"] for t in result["tags"]]
        assert "bitcoin" in tag_names

    def test_total_precedents_increments(self, direct_deploy, direct_owner, direct_vm):
        contract = deploy_charter(direct_deploy)
        self._record(contract, direct_vm, direct_owner)
        self._record(
            contract, direct_vm, direct_owner,
            precedent_id="prec-002",
            market_id="vm2-def456",
        )
        stats = json.loads(contract.get_registry_stats())
        assert stats["total_precedents"] == 2


# ---------------------------------------------------------------------------
# The charter half of the settlement write back
# ---------------------------------------------------------------------------
# tests/direct/test_market.py proves VantageMarket.settle emits a
# record_precedent call whose arguments satisfy precedent_rules. These tests
# prove the registry accepts a payload of exactly that shape and serves it back
# through the lookups the compiler uses. Direct mode loads one contract per
# test, so the write back is verified from both ends against the shared rules.


class TestSettlementWriteBack:
    def _register_market(self, contract, direct_vm, direct_owner):
        """Authorize a market contract as a registrar, the way deploy.mjs does."""
        market_address = "0x" + "11" * 20
        with direct_vm.prank(direct_owner):
            contract.authorize_registrar(market_address)
        return market_address

    def test_settled_market_payload_is_accepted(self, direct_deploy, direct_owner, direct_vm):
        payload = dict(precedent_rules.SETTLED_MARKET_PAYLOAD)
        precedent_rules.assert_charter_accepts(payload)

        contract = deploy_charter(direct_deploy)
        market_address = self._register_market(contract, direct_vm, direct_owner)

        # Called positionally, exactly as the market emits it.
        with direct_vm.prank(market_address):
            raw = contract.record_precedent(*precedent_rules.positional(payload))

        record = json.loads(raw)
        assert record["precedent_id"] == payload["precedent_id"]
        assert record["market_id"] == payload["market_id"]
        assert record["outcome"] == payload["outcome"]
        assert record["reason_code"] == payload["reason_code"]
        assert record["predicate_type"] == payload["predicate_type"]
        assert record["charter_version"] == payload["charter_version"]
        assert record["spec_pattern"] == payload["spec_pattern"]
        assert record["tags"] == precedent_rules.usable_tags(payload["tags_csv"])
        assert record["recorded_by"].lower() == market_address.lower()

        stats = json.loads(contract.get_registry_stats())
        assert stats["total_precedents"] == 1

    def test_written_precedent_is_served_back_by_tag(self, direct_deploy, direct_owner, direct_vm):
        payload = dict(precedent_rules.SETTLED_MARKET_PAYLOAD)
        contract = deploy_charter(direct_deploy)
        market_address = self._register_market(contract, direct_vm, direct_owner)
        with direct_vm.prank(market_address):
            contract.record_precedent(*precedent_rules.positional(payload))

        # lookup_by_tag takes one argument: the tag.
        for tag in precedent_rules.usable_tags(payload["tags_csv"]):
            found = json.loads(contract.lookup_by_tag(tag))
            assert found["tag"] == tag
            assert found["count"] == 1, (tag, found)
            assert found["matches"][0]["precedent_id"] == payload["precedent_id"]

        # And the compiler's own lookup finds it, ranked by tag overlap.
        for_spec = json.loads(contract.lookup_for_spec(payload["tags_csv"], 5))
        assert for_spec["count"] == 1
        assert for_spec["matches"][0]["tag_overlap"] == len(
            precedent_rules.usable_tags(payload["tags_csv"])
        )

        by_market = json.loads(contract.get_precedents_for_market(payload["market_id"]))
        assert by_market["count"] == 1
        assert json.loads(contract.get_precedent(payload["precedent_id"]))["outcome"] == payload["outcome"]

    def test_lookup_by_tag_takes_exactly_one_argument(self, direct_deploy, direct_owner, direct_vm):
        contract = deploy_charter(direct_deploy)
        market_address = self._register_market(contract, direct_vm, direct_owner)
        with direct_vm.prank(market_address):
            contract.record_precedent(
                *precedent_rules.positional(dict(precedent_rules.SETTLED_MARKET_PAYLOAD))
            )

        assert json.loads(contract.lookup_by_tag("ethereum"))["count"] == 1
        # A second positional argument is not part of the declared signature.
        with pytest.raises(Exception):
            contract.lookup_by_tag("ethereum", 20)

    def test_an_unauthorized_market_cannot_write_precedent(
        self, direct_deploy, direct_owner, direct_vm, direct_alice
    ):
        contract = deploy_charter(direct_deploy)
        with direct_vm.prank(direct_alice):
            with direct_vm.expect_revert("[EXPECTED]"):
                contract.record_precedent(
                    *precedent_rules.positional(dict(precedent_rules.SETTLED_MARKET_PAYLOAD))
                )

    def test_every_settlement_reason_code_is_in_the_enum(self, direct_deploy, direct_owner, direct_vm):
        """
        The reason codes a settlement can carry all have to be recordable, or the
        write back would revert on exactly the markets that were contested.
        """
        contract = deploy_charter(direct_deploy)
        market_address = self._register_market(contract, direct_vm, direct_owner)
        settlement_reasons = (
            "QUORUM_MET",
            "CHALLENGE_UPHELD",
            "CHALLENGE_REJECTED",
            "APPEAL_UPHELD",
            "APPEAL_REJECTED",
        )
        for index, reason in enumerate(settlement_reasons):
            assert reason in precedent_rules.REASON_CODES
            payload = dict(precedent_rules.SETTLED_MARKET_PAYLOAD)
            payload["precedent_id"] = f"prec-reason-{index}"
            payload["market_id"] = f"vm{index}-reasoncheck"
            payload["reason_code"] = reason
            precedent_rules.assert_charter_accepts(payload)
            with direct_vm.prank(market_address):
                stored = json.loads(contract.record_precedent(*precedent_rules.positional(payload)))
            assert stored["reason_code"] == reason

        assert json.loads(contract.get_registry_stats())["total_precedents"] == len(settlement_reasons)
