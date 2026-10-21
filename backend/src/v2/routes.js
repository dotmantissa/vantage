import express from 'express';
import { sql } from '../db.js';
import { requireAuth } from '../auth.js';
import { configuration, read, chainClient } from './config.js';
import { outcome } from './outcome.js';
import { enqueue } from './jobs.js';
import { migrateV2 } from './schema.js';
import {runOnce} from './runner.js';
import {cronAuthorized} from './cron-auth.js';
const router=express.Router();
let migration;
const ready=()=>migration||(migration=migrateV2(sql).catch(error=>{migration=null;throw error;}));
const route=fn=>async(req,res)=>{try{await fn(req,res);}catch(error){res.status(error.status||500).json({error:error.message});}};
router.get('/cron',route(async(req,res)=>{
  if(!cronAuthorized(req.headers.authorization))return res.status(401).json({error:'Keeper authentication required'});
  await ready();res.json(await runOnce());
}));
router.get('/archives/:hash',route(async(req,res)=>{
  if(!/^[0-9a-f]{64}$/.test(req.params.hash))return res.status(400).json({error:'Invalid archive hash'});
  await ready();const key=`consensus/${req.params.hash}.json`;
  const rows=await sql`SELECT body FROM v2_archives WHERE archive_key=${key}`;
  if(!rows.length)return res.status(404).json({error:'Archive not found'});
  res.set('Cache-Control','public, max-age=31536000, immutable').type('application/json').send(rows[0].body);
}));
router.get('/config',(_req,res)=>{const config=configuration();res.json({...config,capabilities:{userSigning:true,nativeAppeals:true,protocolFeeDistribution:false,finalizedCrossContractReads:config.network!=='studionet'},preview:config.network==='studionet'||process.env.VANTAGE_PREVIEW==='1'});});
router.get('/markets',route(async(req,res)=>{
  const config=configuration();if(!config.configured)return res.json({markets:[],configured:false,total:0});
  await ready();const rows=await sql`SELECT body,prices,indexed_at FROM v2_markets WHERE network=${config.network} AND contract=${config.contracts.market} ORDER BY market_id DESC`;
  let markets=rows.map(r=>({...r.body,prices_bps:r.prices,indexed_at:r.indexed_at}));
  if(req.query.search)markets=markets.filter(m=>m.spec.question.toLowerCase().includes(String(req.query.search).toLowerCase()));
  if(req.query.kind)markets=markets.filter(m=>m.spec.kind===req.query.kind);
  if(req.query.state)markets=markets.filter(m=>m.state===req.query.state);
  if(req.query.sort==='volume')markets.sort((a,b)=>BigInt(a.volume_wei)>BigInt(b.volume_wei)?-1:1);
  if(req.query.sort==='closing')markets.sort((a,b)=>a.spec.close_time-b.spec.close_time);
  const total=markets.length;const offset=Math.max(0,Number(req.query.offset)||0);const limit=Math.min(100,Math.max(1,Number(req.query.limit)||50));
  res.json({markets:markets.slice(offset,offset+limit),total,configured:true});
}));
router.get('/markets/:id',route(async(req,res)=>{
  const m=await read('get_market',[req.params.id]);
  const [prices,evidence,resolution]=await Promise.all([read('get_prices',[req.params.id]),read('get_evidence',[req.params.id]),read('get_resolution_record',[req.params.id])]);
  res.json({...m,prices_bps:prices.prices_bps,evidence,resolution});
}));
router.get('/markets/:id/evidence',route(async(req,res)=>res.json({evidence:await read('get_evidence',[req.params.id])})));
router.get('/markets/:id/position/:address',route(async(req,res)=>{
  if(!/^0x[0-9a-fA-F]{40}$/.test(req.params.address))return res.status(400).json({error:'Invalid wallet address'});
  res.json(await read('get_position',[req.params.id,req.params.address]));
}));
router.get('/markets/:id/history',route(async(req,res)=>{
  const config=configuration();await ready();
  const rows=await sql`SELECT body,finalized FROM v2_activity WHERE network=${config.network} AND contract=${config.contracts.market} AND market_id=${req.params.id} ORDER BY sequence`;
  res.json({activity:rows.map(r=>({...r.body,finalized:r.finalized})),history:rows.filter(r=>['BUY','SELL'].includes(r.body.kind)).map(r=>({timestamp:r.body.timestamp,prices_bps:r.body.payload.prices_bps,sequence:r.body.sequence,finalized:r.finalized}))});
}));
router.get('/markets/:id/quote',route(async(req,res)=>{
  if(!['buy','sell'].includes(req.query.action)||!/^\d{1,78}$/.test(String(req.query.amount))||!/^\d$/.test(String(req.query.outcome)))return res.status(400).json({error:'Invalid quote parameters'});
  res.json(await read(req.query.action==='buy'?'quote_buy':'quote_sell',[req.params.id,Number(req.query.outcome),req.query.amount]));
}));
router.get('/drafts',route(async(req,res)=>{
  if(!/^0x[0-9a-fA-F]{40}$/.test(String(req.query.author)))return res.status(400).json({error:'Invalid author'});
  if(!configuration().configured)return res.json({drafts:[],total:0});
  res.json(await read('list_drafts',[req.query.author,Math.max(0,Number(req.query.offset)||0),50]));
}));
router.get('/drafts/:id',route(async(req,res)=>res.json(await read('get_draft',[req.params.id]))));
router.get('/charter',route(async(req,res)=>{
  const config=configuration();if(!config.configured)return res.json({configured:false,sources:[],templates:[]});
  res.json({...await read('get_charter',[String(req.query.version||'')],'charter'),configured:true});
}));
router.get('/precedents',route(async(req,res)=>{
  const config=configuration();if(!config.configured)return res.json({records:[],configured:false});
  res.json(req.query.search?{records:await read('search',[String(req.query.search).slice(0,600),10],'memory')}:await read('list_precedents',[0,50],'memory'));
}));
router.get('/portfolio/:address',route(async(req,res)=>{
  const address=req.params.address;if(!/^0x[0-9a-fA-F]{40}$/.test(address))return res.status(400).json({error:'Invalid address'});
  const config=configuration();if(!config.configured)return res.json({positions:[],balance_wei:'0'});
  const balance=await read('get_balance',[address]);const positions=[];let offset=0,total=1;
  while(offset<total){const page=await read('list_markets',[offset,50]);total=page.total;for(const m of page.markets){const pos=await read('get_position',[m.market_id,address]);if(pos.shares.some(s=>BigInt(s)>0n)||BigInt(pos.lp_shares)>0n)positions.push({market:m,...pos});}if(!page.markets.length)break;offset+=page.markets.length;}
  res.json({positions,balance_wei:String(balance)});
}));
router.post('/transactions',requireAuth,route(async(req,res)=>{
  const {hash,method,market_id}=req.body;
  if(!/^0x[0-9a-fA-F]{64}$/.test(hash)||!['compile_draft','activate_draft','buy','sell','record_evidence','add_liquidity','remove_liquidity','challenge','appeal','resolve','finalize','settle','claim','withdraw','close_market','void_expired'].includes(method))return res.status(400).json({error:'Invalid transaction tracking request'});
  await ready();const config=configuration();
  const tx=await chainClient(config).getTransaction({hash});
  const sender=String(tx?.from_address||tx?.from||tx?.sender||'').toLowerCase();
  if(!sender||sender!==req.user.address)return res.status(403).json({error:'Transaction belongs to a different wallet'});
  const destination=String(tx?.to_address||tx?.recipient||tx?.to||'').toLowerCase();
  const actualMethod=tx?.txDataDecoded?.callData?.method||tx?.data?.calldata?.method;
  if(actualMethod&&actualMethod!==method)return res.status(400).json({error:'Tracking method differs from signed transaction'});
  if(destination!==config.contracts.market?.toLowerCase())return res.status(403).json({error:'Transaction does not target the configured market contract'});
  await sql`INSERT INTO v2_transactions(network,tx_hash,actor,method,market_id) VALUES(${config.network},${hash},${req.user.address},${method},${market_id||null}) ON CONFLICT(network,tx_hash) DO NOTHING`;
  await enqueue(sql,`track:${hash}`,'track',{hash});res.status(202).json({hash});
}));
router.get('/transactions/:hash',route(async(req,res)=>{
  const config=configuration();const hash=req.params.hash;if(!/^0x[0-9a-fA-F]{64}$/.test(hash))return res.status(400).json({error:'Invalid transaction hash'});
  const tx=await chainClient(config).getTransaction({hash});const result=outcome(tx,hash,config.network);
  const client=chainClient(config);let appeal={available:false,eligible:false,charge_wei:null};
  try{appeal.eligible=await client.canAppeal({txId:hash});appeal.available=true;if(appeal.eligible)appeal.charge_wei=String(await client.getMinAppealBond({txId:hash}));}catch{/* Network may not expose appeal methods in Studio. */}
  res.json({...result,appeal});
}));
router.get('/watchlist',requireAuth,route(async(req,res)=>{await ready();const config=configuration();const rows=await sql`SELECT market_id FROM v2_watchlists WHERE actor=${req.user.address} AND network=${config.network}`;res.json({market_ids:rows.map(r=>r.market_id)});}));
router.put('/watchlist/:id',requireAuth,route(async(req,res)=>{await ready();const config=configuration();await sql`INSERT INTO v2_watchlists(actor,network,market_id) VALUES(${req.user.address},${config.network},${req.params.id}) ON CONFLICT DO NOTHING`;res.json({saved:true});}));
router.delete('/watchlist/:id',requireAuth,route(async(req,res)=>{await ready();const config=configuration();await sql`DELETE FROM v2_watchlists WHERE actor=${req.user.address} AND network=${config.network} AND market_id=${req.params.id}`;res.json({saved:false});}));
router.get('/health',route(async(_req,res)=>{
  const config=configuration();if(!process.env.DATABASE_URL)return res.json({status:'unconfigured',configured:config.configured,database:false});
  await ready();const rows=await sql`SELECT state,count(*)::int AS count FROM v2_jobs GROUP BY state`;const lag=await sql`SELECT max(indexed_at) AS last_index FROM v2_markets WHERE network=${config.network}`;
  const runs=await sql`SELECT started_at,finished_at,body FROM v2_service_runs ORDER BY started_at DESC LIMIT 1`;
  const archive=process.env.VANTAGE_ARCHIVE==='postgres'?'postgres':process.env.R2_ENDPOINT&&process.env.R2_BUCKET&&process.env.R2_ACCESS_KEY_ID&&process.env.R2_SECRET_ACCESS_KEY?'r2':null;
  res.json({status:'ok',configured:config.configured,jobs:rows,last_index:lag[0]?.last_index,archive_configured:!!archive,archive_backend:archive,keeper_configured:!!(process.env.KEEPER_KEY&&process.env.CRON_SECRET),last_worker:runs[0]||null});
}));
export default router;
