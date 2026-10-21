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
            if method=='get_market':
                return bytes([0])+calldata.encode(contract.get_market(request['CallContract']['calldata']['args'][0]))
            return bytes([0])+calldata.encode(json.dumps(CHARTER) if method=='get_charter' else '[]')
        if 'PostMessage' in request:
            vm.v2_messages=getattr(vm,'v2_messages',[])+[request['PostMessage']]
            return {'ok':None}
    direct_vm._gl_call_hook=hook
    direct_vm.mock_web('.*api.github.com.*',{'status':200,'body':'A public release exists and is available. record=release-1'})
    direct_vm.mock_llm('.*Review a prediction market.*',json.dumps({'resolvable':True,'issues':[],'relevant_precedents':[],'summary':'Specific public delivery criteria.'}))
    contract=direct_deploy(PATH,charter_address=ADDR,memory_address=ADDR)
    return contract

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

def test_finalized_cross_reads_are_default_and_preview_is_explicit(market):
    assert json.loads(market.get_config())['finalized_reads'] is True
    market.finalized_reads = False
    assert json.loads(market.get_config())['finalized_reads'] is False

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

def warp_past_close(m,direct_vm):
    direct_vm.warp(time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime(m['spec']['close_time']+1)))

def complete_resolution(market,direct_vm,m):
    evidence_mock(direct_vm,int(time.time()))
    market.record_evidence(m['market_id'],0)
    warp_past_close(m,direct_vm)
    market.close_market(m['market_id'])
    result=json.loads(market.resolve(m['market_id']))
    direct_vm.warp(time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime(result['appeal_deadline']+1)))
    market.finalize(m['market_id'])
    return json.loads(market.settle(m['market_id']))

def test_quotes_match_execution_and_conserve_complete_sets(market,direct_vm,direct_bob):
    m=activate(market,direct_vm);mid=m['market_id']
    direct_vm.sender=direct_bob
    quote=json.loads(market.quote_buy(mid,0,'1000'))
    direct_vm.value=1000
    trade=json.loads(market.buy(mid,0,quote['shares_out']))
    assert quote['shares_out']==trade['shares_out']
    direct_vm.value=0
    book=json.loads(market.get_market(mid));pos=json.loads(market.get_position(mid,str(direct_bob)))
    for idx,reserve in enumerate(book['reserves']):
        assert int(reserve)+int(pos['shares'][idx])==int(book['minted_wei'])
    sell=json.loads(market.quote_sell(mid,0,trade['shares_out']))
    result=json.loads(market.sell(mid,0,trade['shares_out'],sell['collateral_out']))
    assert result['collateral_out']==sell['collateral_out']
    book=json.loads(market.get_market(mid))
    assert all(int(r)==int(book['collateral_wei']) for r in book['reserves'])

def test_zero_slippage_minimum_and_overdraw_rejected(market,direct_vm):
    m=activate(market,direct_vm);direct_vm.value=1000
    with pytest.raises(Exception,match='minimum'):
        market.buy(m['market_id'],0,'0')
    direct_vm.value=0
    with pytest.raises(Exception,match='Insufficient shares'):
        market.sell(m['market_id'],0,'1','1')

def test_settlement_is_constant_work_and_claims_idempotent(market,direct_vm,direct_bob,direct_owner):
    m=activate(market,direct_vm);mid=m['market_id'];owner=str(direct_owner)
    direct_vm.sender=direct_bob;direct_vm.value=1000
    q=json.loads(market.quote_buy(mid,0,'1000'));market.buy(mid,0,q['shares_out']);direct_vm.value=0
    final=complete_resolution(market,direct_vm,m)
    assert final['state']=='SETTLED'
    assert final['payout']['paid_wei']=='0'
    before=int(market.get_balance(str(direct_bob)))
    claim=json.loads(market.claim(mid))
    assert int(market.get_balance(str(direct_bob)))==before+int(claim['claimed_wei'])
    with pytest.raises(Exception,match='Claim unavailable'):
        market.claim(mid)
    direct_vm.sender=direct_owner
    lp=json.loads(market.claim(mid))
    assert int(lp['claimed_wei'])+int(claim['claimed_wei'])==int(final['payout']['collateral_wei'])
    market.withdraw()
    assert market.get_balance(owner)=='0'
    assert direct_vm.v2_messages[-1]['on']=='finalized'

def test_evidence_failures_wait_and_void_only_after_deadline(market,direct_vm):
    m=activate(market,direct_vm);warp_past_close(m,direct_vm);market.close_market(m['market_id'])
    result=json.loads(market.resolve(m['market_id']))
    assert result['state']=='AWAITING_EVIDENCE'
    with pytest.raises(Exception,match='deadline not reached'):
        market.void_expired(m['market_id'])
    direct_vm.warp(time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime(m['grace_deadline']+1)))
    result=json.loads(market.void_expired(m['market_id']))
    assert result['state']=='VOID'
    assert json.loads(market.claim(m['market_id']))['claimed_wei']=='10000'

def test_partial_delivery_has_deterministic_mapping(market,direct_vm):
    m=activate(market,direct_vm);warp_past_close(m,direct_vm)
    observed=m['spec']['observation']['end']
    evidence_mock(direct_vm,observed,criteria=[{'id':'released','decision':'MET','citation':'A public release exists'},{'id':'available','decision':'UNMET','citation':'is available'}])
    market.record_evidence(m['market_id'],0)
    market.close_market(m['market_id'])
    result=json.loads(market.resolve(m['market_id']))
    assert result['winning_outcome']==1
    assert result['state']=='PROVISIONAL'

def test_unsettled_parent_blocks_child_and_void_parent_unwinds(market,direct_vm):
    parent=activate(market,direct_vm)
    p=proposal();p['condition']={'market_id':parent['market_id'],'outcome_index':0};p['question']='Will the next release ship if the parent release succeeds?'
    draft=json.loads(market.compile_draft(json.dumps(p)));direct_vm.value=10500
    child=json.loads(market.activate_draft(draft['id'],draft['spec_hash'],'10000'));direct_vm.value=0
    warp_past_close(child,direct_vm);market.close_market(child['market_id'])
    waiting=json.loads(market.resolve(child['market_id']))
    assert waiting['reason_code']=='CONDITION_PENDING'
    direct_vm.warp(time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime(parent['grace_deadline']+1)))
    market.void_expired(parent['market_id'])
    result=json.loads(market.resolve(child['market_id']))
    assert result['state']=='VOID' and result['reason_code']=='CONDITION_UNMET'

def test_liquidity_after_trade_preserves_claim_conservation(market,direct_vm,direct_bob,direct_charlie):
    m=activate(market,direct_vm);mid=m['market_id']
    direct_vm.sender=direct_bob;direct_vm.value=1000;market.buy(mid,0,'1');direct_vm.value=0
    direct_vm.sender=direct_charlie;direct_vm.value=2000;market.add_liquidity(mid);direct_vm.value=0
    complete_resolution(market,direct_vm,m)
    for who in [direct_vm.sender,direct_bob]:
        direct_vm.sender=who;market.claim(mid)
    book=json.loads(market.get_market(mid))
    assert int(book['payout']['paid_wei'])<=int(book['payout']['collateral_wei'])

def test_draft_recovery_is_author_scoped_and_paginated(market,direct_vm,direct_bob):
    draft=json.loads(market.compile_draft(json.dumps(proposal())))
    owner=draft['author']
    assert json.loads(market.list_drafts(owner))['drafts'][0]['spec_hash']==draft['spec_hash']
    assert json.loads(market.list_drafts(str(direct_bob)))['drafts']==[]
    assert json.loads(market.list_drafts(owner,1))['drafts']==[]

def test_incomplete_criterion_keeps_independent_support(market,direct_vm):
    m=activate(market,direct_vm)
    evidence_mock(direct_vm,int(time.time()),criteria=[{'id':'released','decision':'MET','citation':'A public release exists'},{'id':'available','decision':'INSUFFICIENT','citation':''}])
    market.record_evidence(m['market_id'],0)
    warp_past_close(m,direct_vm);market.close_market(m['market_id'])
    market.resolve(m['market_id'])
    r=json.loads(market.get_resolution_record(m['market_id']))
    assert r['criteria'][0]['decision']=='MET'
    assert r['criteria'][1]['decision']=='INSUFFICIENT'
    assert r['winner'] is None

def test_numeric_value_is_decided_deterministically_without_llm_label(market,direct_vm):
    p=proposal();p.update(kind='numeric',outcomes=['Yes','No'],comparator='gte',threshold='42.125',units='units')
    d=json.loads(market.compile_draft(json.dumps(p)));direct_vm.value=10500
    m=json.loads(market.activate_draft(d['id'],d['spec_hash'],'10000'));direct_vm.value=0
    evidence_mock(direct_vm,int(time.time()),numeric_value='42.125',criteria=[{'id':'released','decision':'INSUFFICIENT','citation':''},{'id':'available','decision':'INSUFFICIENT','citation':''}])
    market.record_evidence(m['market_id'],0);warp_past_close(m,direct_vm);market.close_market(m['market_id'])
    result=json.loads(market.resolve(m['market_id']))
    assert result['winning_outcome']==0

def test_invalid_numeric_sign_rejected(market):
    p=proposal();p.update(kind='numeric',outcomes=['Yes','No'],comparator='gte',threshold='--42',units='units')
    with pytest.raises(Exception,match='Plain decimal'):
        market.compile_draft(json.dumps(p))

def test_predeadline_spam_cannot_exhaust_observation_budget(market,direct_vm):
    m=activate(market,direct_vm);evidence_mock(direct_vm,int(time.time()))
    for _ in range(CHARTER['max_evidence']//2):
        market.record_evidence(m['market_id'],0)
    with pytest.raises(Exception,match='reserved'):
        market.record_evidence(m['market_id'],0)
