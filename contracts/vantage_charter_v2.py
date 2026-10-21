# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
"""Immutable V2 source, rubric and economic policies. No nondeterministic calls."""
import json
from genlayer import *

class VantageCharterV2(gl.Contract):
    owner: Address
    active_version: str
    versions: TreeMap[str, str]
    version_ids: DynArray[str]

    def __init__(self):
        self.owner = gl.message.sender_address
        body = {
            "version": "v2.1", "challenge_window": 86400, "appeal_window": 86400,
            "evidence_grace": 604800, "retry_seconds": 900, "max_evidence": 24,
            "fee_bps": 200, "lp_fee_bps": 120, "creator_fee_bps": 40,
            "author_bond_wei": "5000000000000000000", "challenge_bond_wei": "10000000000000000000",
            "appeal_bond_wei": "25000000000000000000", "keeper_bounty_wei": "500000000000000000",
            "sources": [
                {"id": "github-api", "host": "api.github.com", "publisher_group": "github", "modes": ["json"], "historical": True, "authoritative": True},
                {"id": "github-web", "host": "github.com", "publisher_group": "github", "modes": ["text", "vision"], "historical": True, "authoritative": True},
                {"id": "sec", "host": "www.sec.gov", "publisher_group": "sec", "modes": ["text"], "historical": True, "authoritative": True},
                {"id": "fed", "host": "www.federalreserve.gov", "publisher_group": "federal-reserve", "modes": ["text"], "historical": True, "authoritative": True},
                {"id": "weather", "host": "api.weather.gov", "publisher_group": "noaa", "modes": ["json"], "historical": True, "authoritative": True},
                {"id": "coingecko", "host": "api.coingecko.com", "publisher_group": "coingecko", "modes": ["json"], "historical": True, "authoritative": False}
            ],
            "templates": [
                {"id": "public-release", "name": "Public release", "criteria": ["A public release record exists", "The release is available to its stated audience", "The promised capability is documented and available"]},
                {"id": "feature-delivery", "name": "Feature delivery", "criteria": ["The feature is accessible to its stated users", "The promised behavior works under the published conditions", "The delivery occurred within the observation period"]}
            ]
        }
        self.versions["v2.1"] = json.dumps(body, sort_keys=True, separators=(",", ":"))
        self.version_ids.append("v2.1")
        self.active_version = "v2.1"

    @gl.public.write
    def publish_charter(self, version: str, body_json: str) -> str:
        if gl.message.sender_address != self.owner:
            raise gl.vm.UserError("[EXPECTED] Only owner")
        if not 2 <= len(version) <= 32 or version in self.versions or len(body_json) > 16000:
            raise gl.vm.UserError("[EXPECTED] Invalid or existing version")
        try:
            body = json.loads(body_json)
        except Exception:
            raise gl.vm.UserError("[EXPECTED] Invalid charter JSON")
        if not isinstance(body, dict):
            raise gl.vm.UserError("[EXPECTED] Charter must be an object")
        current = json.loads(self.versions[self.active_version])
        required = set(current.keys())
        if not required.issubset(set(body.keys())) or body.get("version") != version:
            raise gl.vm.UserError("[EXPECTED] Missing charter fields or version mismatch")
        for key in ("challenge_window", "appeal_window", "evidence_grace", "retry_seconds", "max_evidence", "fee_bps", "lp_fee_bps", "creator_fee_bps"):
            if type(body[key]) is not int or body[key] <= 0:
                raise gl.vm.UserError("[EXPECTED] Positive integer policy required")
        if body["fee_bps"] > 1000 or body["lp_fee_bps"] + body["creator_fee_bps"] > body["fee_bps"]:
            raise gl.vm.UserError("[EXPECTED] Invalid fee split")
        if body["max_evidence"] > 64 or body["evidence_grace"] < body["retry_seconds"]:
            raise gl.vm.UserError("[EXPECTED] Invalid bounded evidence policy")
        for key in ("author_bond_wei", "challenge_bond_wei", "appeal_bond_wei", "keeper_bounty_wei"):
            if not str(body[key]).isdigit() or int(body[key]) <= 0:
                raise gl.vm.UserError("[EXPECTED] Invalid bond or bounty")
        sources = body["sources"]
        if not isinstance(sources, list) or not 1 <= len(sources) <= 32:
            raise gl.vm.UserError("[EXPECTED] Invalid source manifest")
        ids = []
        for source in sources:
            if not isinstance(source, dict) or not all(k in source for k in ("id", "host", "publisher_group", "modes", "historical", "authoritative")):
                raise gl.vm.UserError("[EXPECTED] Incomplete source manifest")
            host = source["host"]
            if not isinstance(host, str) or "." not in host or any(c not in "abcdefghijklmnopqrstuvwxyz0123456789-." for c in host):
                raise gl.vm.UserError("[EXPECTED] Invalid manifest host")
            if not source["id"] or source["id"] in ids or not source["publisher_group"] or not source["modes"] or any(m not in ("json", "text", "vision") for m in source["modes"]):
                raise gl.vm.UserError("[EXPECTED] Invalid manifest identity or modes")
            if type(source["historical"]) is not bool or type(source["authoritative"]) is not bool:
                raise gl.vm.UserError("[EXPECTED] Manifest flags must be booleans")
            ids.append(source["id"])
        if not isinstance(body["templates"], list) or len(body["templates"]) > 16:
            raise gl.vm.UserError("[EXPECTED] Invalid templates")
        self.versions[version] = json.dumps(body, sort_keys=True, separators=(",", ":"))
        self.version_ids.append(version)
        return version

    @gl.public.write
    def set_active_version(self, version: str) -> None:
        if gl.message.sender_address != self.owner or version not in self.versions:
            raise gl.vm.UserError("[EXPECTED] Invalid owner or version")
        self.active_version = version

    @gl.public.view
    def get_charter(self, version: str = "") -> str:
        selected = version or self.active_version
        if selected not in self.versions:
            raise gl.vm.UserError("[EXPECTED] Unknown charter")
        return self.versions[selected]

    @gl.public.view
    def list_versions(self) -> str:
        return json.dumps(list(self.version_ids))
