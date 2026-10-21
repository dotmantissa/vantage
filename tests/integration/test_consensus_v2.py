"""Five-validator GLSim tests. Real GenVM/vision/embeddings remain separate gates."""
import json
import time
from pathlib import Path
import pytest
from glsim.engine import SimEngine
from glsim.state import StateStore, TxStatus
from glsim.consensus import run_consensus

OWNER='0x1111111111111111111111111111111111111111'

@pytest.fixture
def engine():
    sim=SimEngine(StateStore(seed='vantage-tests'))
    sim.activate()
    sim.vm.warp(time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()))
    yield sim
    sim.deactivate()

def transact(engine,address,method,args=(),value=0):
    engine.vm.value=value
    result=run_consensus(engine,lambda:(engine.call_method(address,method,list(args),sender=OWNER),b''),5,3)
    engine.vm.value=0
    assert result.status==TxStatus.FINALIZED, result.error
    assert result.error is None, result.error
    assert result.votes==['agree']*5
    return json.loads(result.result) if isinstance(result.result,str) and result.result.startswith(('{','[')) else result.result

def deploy(engine):
    charter,_=engine.deploy('contracts/vantage_charter_v2.py',sender=OWNER)
    # Empty memory does not instantiate a model. Runtime embedding writes are
    # deliberately tested separately; no fake model is passed off as GenVM.
    memory,_=engine.deploy('contracts/vantage_memory_v2.py',sender=OWNER)
    market,_=engine.deploy('contracts/vantage_market_v2.py',[charter,memory],sender=OWNER)
    return charter,memory,market

def proposal():
    now=int(time.time())
    return {'kind':'commitment','question':'Will the public release actually deliver its documented capability?',
      'outcomes':['Delivered','Partially delivered','Not delivered'],'close_time':now+600,
      'observation':{'mode':'BY_DEADLINE','start':now-60,'end':now+600},
      'sources':[{'manifest_id':'github-api','url':'https://api.github.com/repos/example/project/releases','mode':'json'}],
      'source_policy':'AUTHORITATIVE','quorum_k':1,
      'criteria':[{'id':'c1','description':'The capability is available to public users'}]}

def mock_review(engine):
    engine.vm.mock_web('.*api.github.com.*',{'status':200,'body':'The capability is available to public users. release-1'})
    engine.vm.mock_llm('.*Review a prediction market.*',json.dumps({'resolvable':True,'issues':[],'relevant_precedents':[],'summary':'Observable delivery.'}))
    engine.vm.mock_llm('.*Compare these independent.*',json.dumps({'equivalent':True}))

def test_review_evidence_and_protected_trade_consensus(engine):
    _,_,market=deploy(engine);mock_review(engine)
    draft=transact(engine,market,'compile_draft',[json.dumps(proposal())])
    m=transact(engine,market,'activate_draft',[draft['id'],draft['spec_hash'],str(10**19)],10**19+5*10**18)
    engine.vm.mock_llm('.*Extract evidence for the LOCKED.*',json.dumps({'record_id':'release-1','observed_at':int(time.time())-1,'historical_verified':True,'facts':{},'numeric_value':None,'negative_complete':False,'origin_group':'github','criteria':[{'id':'c1','decision':'MET','citation':'The capability is available to public users'}]}))
    e=transact(engine,market,'record_evidence',[m['market_id'],0])
    assert e['historical_verified']
    quote=json.loads(engine.call_method(market,'quote_buy',[m['market_id'],0,str(10**18)]))
    trade=transact(engine,market,'buy',[m['market_id'],0,quote['shares_out']],10**18)
    assert trade['shares_out']==quote['shares_out']

def test_validator_material_disagreement_exhausts_rotations(engine):
    _,_,market=deploy(engine);mock_review(engine)
    draft=transact(engine,market,'compile_draft',[json.dumps(proposal())])
    m=transact(engine,market,'activate_draft',[draft['id'],draft['spec_hash'],str(10**19)],10**19+5*10**18)
    count=[0]
    def varying(prompt,**_kwargs):
        count[0]+=1
        return {'record_id':f'release-{count[0]}','observed_at':int(time.time())-1,'historical_verified':True,'facts':{},'numeric_value':None,'negative_complete':False,'origin_group':'github','criteria':[{'id':'c1','decision':'MET','citation':'The capability is available to public users'}]}
    import genlayer.gl as gl
    original=gl.nondet.exec_prompt
    gl.nondet.exec_prompt=varying
    try:
        result=run_consensus(engine,lambda:(engine.call_method(market,'record_evidence',[m['market_id'],0]),b''),5,3)
        assert result.status==TxStatus.UNDETERMINED
        assert result.rotation==2
        assert result.votes==['disagree']*5
        # GLSim 0.29.2 replaces storage managers but existing IC objects retain
        # old slots. Its failed-rotation rollback is defective. Do not infer
        # real network rollback from this simulator; GenVM is a release gate.
    finally:
        gl.nondet.exec_prompt=original
