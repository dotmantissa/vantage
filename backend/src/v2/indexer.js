import { configuration, read } from './config.js';
export async function indexV2(sql,config=configuration()) {
  if (!config.configured) return {configured:false};
  const contract=config.contracts.market;
  let offset=0,total=1,markets=0;
  while(offset<total) {
    const page=await read('list_markets',[offset,50],'market',config);total=page.total;
    for(const m of page.markets) {
      const prices=await read('get_prices',[m.market_id],'market',config);
      await sql`INSERT INTO v2_markets(network,contract,market_id,body,prices,indexed_at) VALUES(${config.network},${contract},${m.market_id},${JSON.stringify(m)}::jsonb,${JSON.stringify(prices.prices_bps)}::jsonb,now()) ON CONFLICT(network,contract,market_id) DO UPDATE SET body=EXCLUDED.body,prices=EXCLUDED.prices,indexed_at=now()`;
      const evidence=await read('get_evidence',[m.market_id],'market',config);
      for(const e of evidence) await sql`INSERT INTO v2_evidence(network,contract,evidence_id,market_id,body) VALUES(${config.network},${contract},${e.id},${m.market_id},${JSON.stringify(e)}::jsonb) ON CONFLICT(network,contract,evidence_id) DO UPDATE SET archive_key=CASE WHEN v2_evidence.body=EXCLUDED.body THEN v2_evidence.archive_key ELSE NULL END,body=EXCLUDED.body,indexed_at=now()`;
      await sql`DELETE FROM v2_evidence WHERE network=${config.network} AND contract=${contract} AND market_id=${m.market_id} AND NOT (evidence_id=ANY(${evidence.map(e=>e.id)}::text[]))`;
      markets++;
    }
    if(!page.markets.length)break;
    offset+=page.markets.length;
  }
  // Replay bounded pages and remove sequence tails after recomputation. The IC
  // activity log, not a browser report, is authority for the chart/trade history.
  offset=0;total=1;
  while(offset<total) {
    const page=await read('list_activity',[offset,100],'market',config);total=page.total;
    for(const e of page.records) await sql`INSERT INTO v2_activity(network,contract,sequence,market_id,body) VALUES(${config.network},${contract},${e.sequence},${e.market_id},${JSON.stringify(e)}::jsonb) ON CONFLICT(network,contract,sequence) DO UPDATE SET market_id=EXCLUDED.market_id,body=EXCLUDED.body,finalized=FALSE`;
    if(!page.records.length)break;
    offset+=page.records.length;
  }
  await sql`DELETE FROM v2_activity WHERE network=${config.network} AND contract=${contract} AND sequence>=${total}`;
  // Only a byte-equivalent record in finalized chain state is marked final.
  let finalOffset=0,finalTotal=1;
  while(finalOffset<finalTotal){
    const page=await read('list_activity',[finalOffset,100],'market',config,true);finalTotal=page.total;
    for(const e of page.records)await sql`UPDATE v2_activity SET finalized=TRUE WHERE network=${config.network} AND contract=${contract} AND sequence=${e.sequence} AND body=${JSON.stringify(e)}::jsonb`;
    if(!page.records.length)break;finalOffset+=page.records.length;
  }
  const listing=await read('list_markets',[0,1],'market',config);
  // A replaced sequence can change earlier market snapshots; all are read above.
  await sql`DELETE FROM v2_markets WHERE network=${config.network} AND contract=${contract} AND (substring(market_id from 3))::bigint>${listing.total}`;
  await sql`DELETE FROM v2_evidence WHERE network=${config.network} AND contract=${contract} AND market_id NOT IN (SELECT market_id FROM v2_markets WHERE network=${config.network} AND contract=${contract})`;
  offset=0;total=1;
  while(offset<total) {
    const page=await read('list_precedents',[offset,50],'memory',config);total=page.total;
    for(const p of page.records)await sql`INSERT INTO v2_precedents(network,contract,precedent_id,body) VALUES(${config.network},${config.contracts.memory},${p.id},${JSON.stringify(p)}::jsonb) ON CONFLICT(network,contract,precedent_id) DO UPDATE SET body=EXCLUDED.body`;
    if(!page.records.length)break;offset+=page.records.length;
  }
  return {configured:true,markets};
}
