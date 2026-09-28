"""
tests/direct/test_charter.py
============================

Direct-mode unit tests for VantageCharter.

Uses gltest.direct fixtures: direct_deploy, direct_owner, direct_alice, direct_bob.
All nondet and cross-contract calls are mocked at the VMContext level.
"""

import json
import pytest

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
