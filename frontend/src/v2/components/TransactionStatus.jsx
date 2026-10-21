import React,{useEffect} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {ExternalLink,Loader2,CheckCircle2,AlertCircle} from 'lucide-react';
import {api} from '../api';
import {saveTransaction} from '../transactions';
export default function TransactionStatus({tx,onResult}){
 const cache=useQueryClient();
 const {data:config}=useQuery({queryKey:['config'],queryFn:()=>api('/config')});
 const {data,error}=useQuery({queryKey:['transaction',tx.hash],queryFn:()=>api(`/transactions/${tx.hash}`),refetchInterval:q=>q.state.data?.finalized?false:5000,retry:1});
 useEffect(()=>{if(data){saveTransaction({...tx,status:data.status,execution:data.execution});if(data.successful){cache.invalidateQueries({queryKey:['markets']});onResult?.(data);}}},[data?.status,data?.successful,data?.execution]);
 return <div className="transaction-row"><span className={data?.successful?'tx-icon success':'tx-icon'}>{data?.successful?<CheckCircle2 size={19}/>:error?<AlertCircle size={19}/>:<Loader2 size={19}/>}</span><div><strong>{tx.method.replaceAll('_',' ')}</strong><p>{error?'Tracking unavailable; your transaction hash is saved.':data?.successful?(data.finalized?'Finalized successfully':'Accepted successfully · awaiting finality'):data?.finalized&&data?.consensus&&!['MAJORITY_AGREE','AGREE'].includes(data.consensus)?'Validators rejected the result · state was not applied':data?.execution&& !data?.successful?'Contract execution failed':data?.status||'Awaiting consensus'}</p><code>{tx.hash.slice(0,12)}…{tx.hash.slice(-8)}</code></div>{data?.appeal?.eligible&&<span className="appeal-eligible">Native appeal available</span>}<a href={`${config?.explorerUrl||'https://studio.genlayer.com'}/transactions/${tx.hash}`} target="_blank" rel="noreferrer" aria-label="Inspect transaction"><ExternalLink size={15}/></a></div>;
}
