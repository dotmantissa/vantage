// Share concurrent public reads within a serverless instance. Keys include the
// network, contract and finality variant; signed writes never enter this cache.
export function createReadCache({maxEntries=500,now=Date.now}={}) {
  const entries=new Map();
  return async function cached(key,load,ttlMs=8000) {
    const existing=entries.get(key);
    if(existing && (existing.pending || existing.expires>now()))return existing.promise;
    if(entries.size>=maxEntries)entries.delete(entries.keys().next().value);
    const entry={pending:true,expires:0};
    entry.promise=Promise.resolve().then(load).then(value=>{
      entry.pending=false;entry.expires=now()+ttlMs;return structuredClone(value);
    },error=>{if(entries.get(key)===entry)entries.delete(key);throw error;});
    entries.set(key,entry);
    return entry.promise;
  };
}
export const cachedRead=createReadCache();
