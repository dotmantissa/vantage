import json
import time
from pathlib import Path
import pytest
from gltest.direct.sdk_loader import setup_sdk_paths
setup_sdk_paths(Path('contracts/vantage_market_v2.py'))
from genlayer.py import calldata

PATH='contracts/vantage_market_v2.py'
ADDR='0x1111111111111111111111111111111111111111'
CHARTER={'version':'v2.1','challenge_window':60,'appeal_window':60,'evidence_grace':3600,'retry_seconds':10,'max_evidence':24,'fee_bps':200,'lp_fee_bps':120,'creator_fee_bps':40,'author_bond_wei':'500','challenge_bond_wei':'100','appeal_bond_wei':'250','keeper_bounty_wei':'10','sources':[{'id':'github-api','host':'api.github.com','publisher_group':'github','modes':['json','text'],'historical':True,'authoritative':True}],'templates':[]}

def proposal():
    now=int(time.time())
    return {'question':'Will the promised public release actually ship?', 'kind':'commitment','outcomes':['Delivered','Partially delivered','Not delivered'],'close_time':now+600,'observation':{'mode':'BY_DEADLINE','start':now-100,'end':now+600},'sources':[{'manifest_id':'github-api','url':'https://api.github.com/repos/example/project/releases','mode':'text'}],'source_policy':'AUTHORITATIVE','quorum_k':1,'criteria':[{'id':'released','description':'A public release record exists'},{'id':'available','description':'The release is available to the stated users'}],'condition':None}

@pytest.fixture
def market(direct_deploy,direct_vm):
    def hook(vm,request):
        if 'CallContract' in request:
            method=request['CallContract'].get('calldata',{}).get('method')
            return bytes([0])+calldata.encode(json.dumps(CHARTER) if method=='get_charter' else '[]')
        if 'PostMessage' in request:
            vm.v2_messages=getattr(vm,'v2_messages',[])+[request['PostMessage']]
            return {'ok':None}
    direct_vm._gl_call_hook=hook
    direct_vm.mock_web('.*api.github.com.*',{'status':200,'body':'A public release exists and is available. record=release-1'})
    direct_vm.mock_llm('.*Review a prediction market.*',json.dumps({'resolvable':True,'issues':[],'relevant_precedents':[],'summary':'Specific public delivery criteria.'}))
    return direct_deploy(PATH,charter_address=ADDR,memory_address=ADDR)

def activate(market,direct_vm,seed=10000):
    draft=json.loads(market.compile_draft(json.dumps(proposal())))
    direct_vm.value=seed+500
    m=json.loads(market.activate_draft(draft['id'],draft['spec_hash'],str(seed)))
    direct_vm.value=0
    return m

def test_reviewed_draft_requires_author_and_exact_hash(market,direct_vm,direct_bob):
    draft=json.loads(market.compile_draft(json.dumps(proposal())))
    direct_vm.value=10500
    with pytest.raises(Exception,match='hash mismatch'):
        market.activate_draft(draft['id'],'wrong','10000')
    direct_vm.sender=direct_bob
    with pytest.raises(Exception,match='Only author'):
        market.activate_draft(draft['id'],draft['spec_hash'],'10000')

def test_activation_locks_spec_and_starts_seeded_book(market,direct_vm):
    m=activate(market,direct_vm)
    assert m['state']=='OPEN'
    assert m['reserves']==['10000']*3
    assert m['spec']['spec_hash']==m['spec_hash']
    assert json.loads(market.list_activity())['total']==2

def test_irrelevant_roots_and_related_publishers_rejected(market):
    p=proposal();p['sources'][0]['url']='https://api.github.com/'
    with pytest.raises(Exception,match='fact path'):
        market.compile_draft(json.dumps(p))
    p=proposal();p['source_policy']='QUORUM';p['quorum_k']=2;p['sources'].append({**p['sources'][0],'url':'https://api.github.com/repos/other/project/releases'})
    with pytest.raises(Exception,match='independent publisher'):
        market.compile_draft(json.dumps(p))

def evidence_mock(direct_vm, observed, **overrides):
    result={'record_id':'release-1','observed_at':observed,'historical_verified':True,'facts':{'release':'release-1'},'numeric_value':None,'negative_complete':True,'origin_group':'github','criteria':[{'id':'released','decision':'MET','citation':'A public release exists'},{'id':'available','decision':'MET','citation':'is available'}]}
    result.update(overrides)
    direct_vm.mock_llm('.*Extract evidence for the LOCKED.*',json.dumps(result))

def test_consensus_checkpoint_preserves_content_and_provenance(market,direct_vm):
    m=activate(market,direct_vm);evidence_mock(direct_vm,int(time.time()))
    e=json.loads(market.record_evidence(m['market_id'],0))
    assert e['historical_verified']
    assert e['content_hash'].startswith('0x')
    assert [c['decision'] for c in e['criteria']]==['MET','MET']
    assert len(json.loads(market.get_evidence(m['market_id'])))==1

def test_missing_history_and_incomplete_negatives_are_insufficient(market,direct_vm):
    m=activate(market,direct_vm)
    evidence_mock(direct_vm,int(time.time()),historical_verified=False)
    e=json.loads(market.record_evidence(m['market_id'],0))
    assert all(c['decision']=='INSUFFICIENT' for c in e['criteria'])
