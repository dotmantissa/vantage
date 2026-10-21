// Gasless, disposable StudioNet runtime probes. No private key is persisted.
import fs from 'node:fs';
import dns from 'node:dns';
import {Agent,setGlobalDispatcher} from 'undici';
import {createClient,createAccount,chains} from 'genlayer-js';
import {outcome} from '../backend/src/v2/outcome.js';
dns.setDefaultResultOrder('ipv4first');setGlobalDispatcher(new Agent({connect:{family:4}}));
const client=createClient({chain:chains.studionet,account:createAccount()});
const report={network:'studionet',purpose:'disposable GenVM runtime smoke',steps:[]};
const save=()=>fs.writeFileSync('/tmp/vantage-runtime-report.json',JSON.stringify(report,(_key,value)=>typeof value==='bigint'?value.toString():value,2));
async function deploy(name,args=[]){
 const code=fs.readFileSync(`contracts/vantage_${name}_v2.py`,'utf8');
 const hash=await client.deployContract({code,args});const step={name,hash,status:'submitted'};report.steps.push(step);save();console.log(name,hash);
 const tx=await client.waitForTransactionReceipt({hash,status:'ACCEPTED',interval:5000,retries:36});
 const result=outcome(tx,hash,'studionet');step.status=result.status;step.execution=result.execution;step.successful=result.successful;step.receipt=tx;save();
 if(!result.successful)throw new Error(`${name} execution ${result.execution}; inspect saved receipt`);
 const address=tx.txDataDecoded?.contractAddress||tx.data?.contract_address||tx.contract_address||tx.to_address||tx.recipient;
 step.address=address;const actual=await client.getContractCode(address);step.code_verified=actual===code;step.schema=await client.getContractSchema(address);save();return address;
}
try{
 const charter=await deploy('charter');const memory=await deploy('memory');const market=await deploy('market',[charter,memory]);
 report.charter=await client.readContract({address:charter,functionName:'get_charter',args:[]});
 report.market=await client.readContract({address:market,functionName:'list_markets',args:[0,1]});save();
 // A real embedding write and search exercises the pinned model runtime.
 const hash=await client.writeContract({address:memory,functionName:'record_precedent',args:[JSON.stringify({id:'runtime-smoke',question:'Did the documented public release deliver its promised capability?',state:'SETTLED'})],value:0n});
 const step={name:'embedding-write',hash,status:'submitted'};report.steps.push(step);save();console.log(step.name,hash);
 const tx=await client.waitForTransactionReceipt({hash,status:'ACCEPTED',interval:5000,retries:36});Object.assign(step,outcome(tx,hash,'studionet'));save();if(!step.successful)throw new Error('Embedding runtime execution failed');
 report.semantic_search=await client.readContract({address:memory,functionName:'search',args:['Public software delivery',5]});save();console.log('Runtime smoke passed');
}catch(error){report.error=error.message;save();console.error(error.message);process.exitCode=1;}
