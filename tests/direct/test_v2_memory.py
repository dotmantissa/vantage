import json
from pathlib import Path
from unittest.mock import patch
import pytest
from gltest.direct.sdk_loader import setup_sdk_paths

setup_sdk_paths(Path('contracts/vantage_memory_v2.py'))
import numpy as np
import genlayer_embeddings

PATH = 'contracts/vantage_memory_v2.py'

def test_only_registrar_can_add_settled_precedents(direct_deploy, direct_vm, direct_bob):
    c = direct_deploy(PATH)
    direct_vm.sender = direct_bob
    with pytest.raises(Exception, match='Only registrar'):
        c.record_precedent('{}')

def test_semantic_records_are_idempotent_and_conflicts_rejected(direct_deploy):
    c = direct_deploy(PATH)
    payload = {'id':'m-1','question':'Did the public release ship?','state':'SETTLED','winner':0}
    model = lambda text: np.ones(384, dtype=np.float32)
    with patch.object(genlayer_embeddings, 'SentenceTransformer', return_value=model):
        c.record_precedent(json.dumps(payload))
        c.record_precedent(json.dumps(payload))
        assert json.loads(c.list_precedents())['total'] == 1
        assert json.loads(c.search('Was the release delivered?'))[0]['id'] == 'm-1'
        payload['winner'] = 1
        with pytest.raises(Exception, match='identity conflict'):
            c.record_precedent(json.dumps(payload))
