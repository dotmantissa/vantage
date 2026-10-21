import {useState,useEffect} from 'react';
import {useAuth} from './auth';
import {api} from './api';
export function useWatchlist(){
 const auth=useAuth();const [saved,setSaved]=useState(()=>{try{return JSON.parse(localStorage.getItem('vantage_watchlist')||'[]');}catch{return [];}}),[error,setError]=useState(null),[synced,setSynced]=useState(false);
 useEffect(()=>{let live=true;setSynced(false);if(auth.authenticated)auth.getAccessToken().then(token=>token?api('/watchlist',{headers:{Authorization:`Bearer ${token}`}}):null).then(data=>{if(live&&data){setSaved(data.market_ids);setSynced(true);}}).catch(()=>{});return()=>{live=false;};},[auth.authenticated]);
 async function save(id){setError(null);const exists=saved.includes(id);try{if(synced){const token=await auth.getAccessToken();if(!token)throw new Error('Sign in again to update your watchlist.');await api(`/watchlist/${id}`,{method:exists?'DELETE':'PUT',headers:{Authorization:`Bearer ${token}`}});}const next=exists?saved.filter(v=>v!==id):[...saved,id];setSaved(next);if(!synced)localStorage.setItem('vantage_watchlist',JSON.stringify(next));}catch(err){setError(err);}}
 return {saved,save,error,synced};
}
