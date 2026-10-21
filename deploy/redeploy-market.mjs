import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {configuration,chainClient,decode} from '../backend/src/v2/config.js';
import {outcome} from '../backend/src/v2/outcome.js';
const config=configuration(),client=chainClient(config,process.env.DEPLOYER_KEY);
if(!process.env.DEPLOYER_KEY)throw new Error('DEPLOYER_KEY is required');
const old=JSON.parse(fs.readFileSync('docs/V2_DEPLOYMENT.json'));
if(old.network!==config.network)throw new Error('Deployment evidence network mismatch');
const path='deployment-v2.pending.json';
const journal=fs.existsSync(path)?JSON.parse(fs.readFileSync(path)): {network:config.network,chainId:config.chainId,deployer:client.account.address,steps:{charter:old.steps.charter,memory:old.steps.memory}};
const save=()=>{fs.writeFileSync(path+'.tmp',JSON.stringify(journal,null,2)+'\n');fs.renameSync(path+'.tmp',path);};
if(journal.deployer!==client.account.address)throw new Error('Journal sender mismatch');
async function wait(hash){const tx=await client.waitForTransactionReceipt({hash,status:'FINALIZED',interval:15000,retries:80});if(!outcome(tx,hash,config.network).successful)throw new Error('Contract execution failed: '+hash);return tx;}
const code=fs.readFileSync('contracts/vantage_market_v2.py','utf8'),digest=createHash('sha256').update(code).digest('hex');
if(journal.steps.market?.code_sha256!==digest && journal.steps.market)throw new Error('Existing market submission source mismatch');
if(!journal.steps.market){journal.steps.market={code_sha256:digest,broadcast_state:'broadcasting'};save();journal.steps.market.hash=await client.deployContract({code,args:[old.contracts.charter,old.contracts.memory,config.network!=='studionet']});journal.steps.market.broadcast_state='submitted';save();console.log('market',journal.steps.market.hash);}
if(!journal.steps.market.hash)throw new Error('Reconcile uncertain deployment before retry');
const tx=await wait(journal.steps.market.hash);const market=tx.to_address||tx.recipient;
if(await client.getContractCode(market)!==code)throw new Error('Source differs');
const marketConfig=decode(await client.readContract({address:market,functionName:'get_config',args:[]}));
if(marketConfig.finalized_reads!==(config.network!=='studionet'))throw new Error('Unexpected read finality');
if(decode(await client.readContract({address:market,functionName:'list_markets',args:[0,1]})).total!==0)throw new Error('Expected empty replacement');
Object.assign(journal.steps.market,{address:market,verified:true});save();
if(!journal.steps.registrar){journal.steps.registrar={broadcast_state:'broadcasting'};save();journal.steps.registrar.hash=await client.writeContract({address:old.contracts.memory,functionName:'set_registrar',args:[market],value:0n});journal.steps.registrar.broadcast_state='submitted';save();}
if(!journal.steps.registrar.hash)throw new Error('Reconcile uncertain registrar submission');
await wait(journal.steps.registrar.hash);
const memoryConfig=decode(await client.readContract({address:old.contracts.memory,functionName:'get_config',args:[]}));
if(memoryConfig.registrar.toLowerCase()!==market.toLowerCase())throw new Error('Registrar verification failed');
const result={schema_version:2,network:config.network,chainId:config.chainId,deployer:client.account.address,contracts:{...old.contracts,market},market_config:marketConfig,verified_at:new Date().toISOString(),runner:'pinned in shared/networks.json',steps:journal.steps};
fs.writeFileSync('deployed_v2.json',JSON.stringify(result,null,2)+'\n');console.log('Verified replacement',market);
