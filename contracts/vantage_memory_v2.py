# {
#   "Seq": [
#     { "Depends": "py-lib-genlayer-embeddings:0bmbm3cyfwxsyh454z53vxqjf47wz2q7smcqp1q4g4a6k2kidnyk" },
#     { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
#   ]
# }
"""Semantic retrieval of finalized case law; similarity never determines a payout."""
import json
import numpy as np
import typing
from dataclasses import dataclass
from genlayer import *
import genlayer_embeddings

@allow_storage
@dataclass
class PrecedentValue:
    precedent_id: str
    question: str

class VantageMemoryV2(gl.Contract):
    owner: Address
    registrar: Address
    records: TreeMap[str, str]
    record_ids: DynArray[str]
    vectors: genlayer_embeddings.VecDB[np.float32, typing.Literal[384], PrecedentValue, genlayer_embeddings.EuclideanDistanceSquared]

    def __init__(self):
        self.owner = gl.message.sender_address
        self.registrar = gl.message.sender_address

    @gl.public.write
    def set_registrar(self, address: str) -> None:
        if gl.message.sender_address != self.owner:
            raise gl.vm.UserError("[EXPECTED] Only owner")
        self.registrar = Address(address)

    @gl.public.write
    def record_precedent(self, payload_json: str) -> str:
        if gl.message.sender_address != self.registrar:
            raise gl.vm.UserError("[EXPECTED] Only registrar")
        try:
            payload = json.loads(payload_json)
        except Exception:
            raise gl.vm.UserError("[EXPECTED] Invalid precedent JSON")
        if not isinstance(payload, dict) or not payload.get("id") or not payload.get("question") or payload.get("state") != "SETTLED":
            raise gl.vm.UserError("[EXPECTED] Final settled precedent required")
        pid = str(payload["id"])
        canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
        if pid in self.records:
            if self.records[pid] != canonical:
                raise gl.vm.UserError("[EXPECTED] Precedent identity conflict")
            return pid
        if len(canonical) > 12000:
            raise gl.vm.UserError("[EXPECTED] Precedent exceeds bound")
        text = str(payload["question"])[:600]
        model = genlayer_embeddings.SentenceTransformer("all-MiniLM-L6-v2")
        emb = model(text)
        self.vectors.insert(emb, PrecedentValue(precedent_id=pid, question=text))
        self.records[pid] = canonical
        self.record_ids.append(pid)
        return pid

    @gl.public.view
    def get_config(self) -> str:
        return json.dumps({"owner": str(self.owner), "registrar": str(self.registrar), "model": "all-MiniLM-L6-v2", "dimensions": 384})

    @gl.public.view
    def search(self, question: str, limit: int = 5) -> str:
        if not 1 <= int(limit) <= 10 or len(question) > 600:
            raise gl.vm.UserError("[EXPECTED] Search exceeds bound")
        if len(self.record_ids) == 0:
            return "[]"
        model = genlayer_embeddings.SentenceTransformer("all-MiniLM-L6-v2")
        emb = model(question)
        matches = []
        for hit in self.vectors.knn(emb, int(limit)):
            matches.append(json.loads(self.records[hit.value.precedent_id]))
        return json.dumps(matches, sort_keys=True)

    @gl.public.view
    def list_precedents(self, offset: int = 0, limit: int = 20) -> str:
        start = max(0, int(offset))
        end = min(len(self.record_ids), start + min(50, max(1, int(limit))))
        return json.dumps({"total": len(self.record_ids), "records": [json.loads(self.records[self.record_ids[i]]) for i in range(start, end)]}, sort_keys=True)
