import { useState } from 'react';
import { useAuth } from './auth';
import { useQueryClient } from '@tanstack/react-query';
import { chains, createClient } from 'genlayer-js';
import { api } from './api';
export const STORAGE_KEY='vantage_v2_transactions';
export function savedTransactions(){try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]');}catch{return [];}}
export function saveTransaction(tx){const rows=savedTransactions().filter(t=>t.hash!==tx.hash);localStorage.setItem(STORAGE_KEY,JSON.stringify([tx,...rows].slice(0,50)));window.dispatchEvent(new Event('vantage-transactions'));}
const sdkNames={studionet:'studionet',testnet_bradbury:'testnetBradbury',localnet:'localnet'};
export function useTransactions(){
  const {wallets,getAccessToken,login,authenticated,available}=useAuth();const cache=useQueryClient();
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(null),[error,setError]=useState(null);
  async function clientFor(config){
    if(!available)throw new Error('Wallet signing awaits Privy configuration.');
    if(!authenticated){login();throw new Error('Connect your wallet to sign this action.');}
    const wallet=wallets.find(w=>w.walletClientType==='privy')||wallets[0];if(!wallet)throw new Error('No signing wallet is available.');
    await wallet.switchChain(config.chainId);
    const provider=await wallet.getEthereumProvider();
    return {client:createClient({chain:chains[sdkNames[config.network]],endpoint:config.rpcUrl,provider,account:wallet.address}),address:wallet.address};
  }
  async function submit(method,args=[],value='0',marketId){
    setBusy(true);setError(null);setMessage('Preparing your wallet…');let hash;
    try{
      const config=await api('/config');if(!config.configured)throw new Error('V2 contracts are not deployed on the selected network.');
      const {client,address}=await clientFor(config);
      setMessage('Approve the transaction in your wallet.');
      hash=await client.writeContract({address:config.contracts.market,functionName:method,args,value:BigInt(value)});
      // Persist immediately after broadcast. No relayer fallback or rebroadcast
      // after a polling error; recovery always follows this same hash.
      saveTransaction({hash,method,market_id:marketId,network:config.network,actor:address,submitted_at:Date.now(),status:'PENDING'});
      setMessage('Submitted. GenLayer validators are reviewing this action. You can navigate away.');
      const token=await getAccessToken();
      if(token)api('/transactions',{method:'POST',headers:{Authorization:`Bearer ${token}`},body:JSON.stringify({hash,method,market_id:marketId})}).catch(()=>{});
      cache.invalidateQueries();return hash;
    }catch(err){setError(hash?new Error(`Transaction ${hash} was submitted. Tracking is temporarily unavailable; recover it from Portfolio.`):err);return null;}
    finally{setBusy(false);}
  }
  async function nativeAppeal(hash){
    setBusy(true);setError(null);
    try{
      const config=await api('/config');const {client,address}=await clientFor(config);
      if(!await client.canAppeal({txId:hash}))throw new Error('The network no longer permits an appeal for this transaction.');
      const charge=await client.getMinAppealBond({txId:hash});
      // Stable SDK returns the ORIGINAL GenLayer tx id, not the appeal's EVM
      // broadcast hash. Preserve that identity and re-poll its consensus round.
      await client.appealTransaction({txId:hash,value:charge});
      const original=savedTransactions().find(t=>t.hash===hash);
      saveTransaction({...original,hash,method:original?.method||'native_appeal',network:config.network,actor:address,native_appeal_at:Date.now(),status:'PENDING'});
      setMessage('Native appeal submitted. The network will re-evaluate the original transaction.');
    }catch(err){setError(err);}finally{setBusy(false);}
  }
  async function nativeFinalize(hash){
    setBusy(true);setError(null);
    try{
      const config=await api('/config');const {client,address}=await clientFor(config);
      const result=await client.getTransaction({hash});
      const status=result.statusName||result.status;
      if(status!=='ACCEPTED')throw new Error('Only an accepted transaction can be finalized.');
      if(await client.canAppeal({txId:hash}))throw new Error('Wait for the native appeal window to close.');
      const evmHash=await client.finalizeTransaction({txId:hash});
      const original=savedTransactions().find(t=>t.hash===hash);
      saveTransaction({...original,hash,method:original?.method||'native_finalize',network:config.network,actor:address,finalization_evm_hash:evmHash,status:'ACCEPTED'});
      setMessage('Network finalization requested. Track the original transaction for its finalized result.');
    }catch(err){setError(err);}finally{setBusy(false);}
  }
  return {submit,nativeAppeal,nativeFinalize,busy,message,error};
}
