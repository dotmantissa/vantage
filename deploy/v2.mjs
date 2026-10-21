import 'dotenv/config';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {configuration,chainClient,decode} from '../backend/src/v2/config.js';
import {outcome} from '../backend/src/v2/outcome.js';
const config=configuration();
if(!process.env.DEPLOYER_KEY)throw new Error('Set DEPLOYER_KEY in the environment.');
const client=chainClient(config,process.env.DEPLOYER_KEY);
const journalPath=fileURLToPath(new URL('../deployment-v2.pending.json',import.meta.url));
const output=fileURLToPath(new URL('../deployed_v2.json',import.meta.url));
const journal=fs.existsSync(journalPath)?JSON.parse(fs.readFileSync(journalPath,'utf8')):{network:config.network,chainId:config.chainId,deployer:client.account.address,steps:{}};
if(journal.network!==config.network||journal.deployer!==client.account.address)throw new Error('Deployment journal belongs to another network or deployer.');
const persist=()=>{fs.writeFileSync(`${journalPath}.tmp`,JSON.stringify(journal,null,2)+'\n');fs.renameSync(`${journalPath}.tmp`,journalPath);};
async function verified(hash){const tx=await client.waitForTransactionReceipt({hash,status:'FINALIZED',interval:5000,retries:120});if(!outcome(tx,hash,config.network).successful)throw new Error(`Execution failed for ${hash}: ${tx.txExecutionResultName||'inspect receipt'}`);return tx;}
async function deploy(name,args=[]){
 const code=fs.readFileSync(new URL(`../contracts/vantage_${name}_v2.py`,import.meta.url),'utf8');
 const digest=createHash('sha256').update(code).digest('hex');
 let step=journal.steps[name];
 if(step&&step.code_sha256!==digest)throw new Error(`Source changed after ${name} submission; use a separate deployment journal.`);
 if(step?.broadcast_state==='broadcasting')throw new Error(`Uncertain ${name} submission: reconcile sender nonce before continuing.`);
 if(!step){step=journal.steps[name]={code_sha256:digest,broadcast_state:'broadcasting'};persist();step.hash=await client.deployContract({code,args});step.broadcast_state='submitted';persist();console.log(`${name} submitted ${step.hash}`);}
 const tx=await verified(step.hash);
 const address=step.address||tx.txDataDecoded?.contractAddress||tx.data?.contract_address||tx.contract_address||tx.to_address||tx.recipient;
 if(!/^0x[0-9a-fA-F]{40}$/.test(address||''))throw new Error(`No contract address in successful ${name} receipt.`);
 const actual=await client.getContractCode(address);if(actual!==code)throw new Error(`${name} deployed code differs from pinned source.`);
 const schema=await client.getContractSchema(address);if(!schema.methods)throw new Error(`${name} schema missing.`);
 step.address=address;step.verified=true;persist();return address;
}
console.log(`Fresh V2 deployment on ${config.network}; V1 remains at its existing addresses.`);
const charter=await deploy('charter');
const memory=await deploy('memory');
const market=await deploy('market',[charter,memory]);
if(!journal.steps.registrar){journal.steps.registrar={broadcast_state:'broadcasting'};persist();journal.steps.registrar.hash=await client.writeContract({address:memory,functionName:'set_registrar',args:[market],value:0n});journal.steps.registrar.broadcast_state='submitted';persist();}
if(!journal.steps.registrar.hash)throw new Error('Uncertain registrar submission: reconcile before continuing.');
await verified(journal.steps.registrar.hash);
const memoryConfig=decode(await client.readContract({address:memory,functionName:'get_config',args:[]}));
if(memoryConfig.registrar.toLowerCase()!==market.toLowerCase())throw new Error('Registrar authorization not applied.');
const policy=decode(await client.readContract({address:charter,functionName:'get_charter',args:[]}));
if(policy.version!=='v2.1')throw new Error('Unexpected charter version.');
const markets=decode(await client.readContract({address:market,functionName:'list_markets',args:[0,1]}));
if(markets.total!==0)throw new Error('Fresh market was expected to be empty.');
const result={schema_version:2,network:config.network,chainId:config.chainId,deployer:client.account.address,contracts:{charter,memory,market},verified_at:new Date().toISOString(),runner:'pinned in shared/networks.json',steps:journal.steps};
fs.writeFileSync(`${output}.tmp`,JSON.stringify(result,null,2)+'\n');fs.renameSync(`${output}.tmp`,output);
console.log(`Verified manifest written to ${output}`);
