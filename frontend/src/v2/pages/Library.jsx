import React,{useState} from 'react';
import {Link} from 'react-router-dom';
import {useQuery} from '@tanstack/react-query';
import {Search,ArrowUpRight,BookOpen,ShieldCheck} from 'lucide-react';
import {api} from '../api';
import {PageHeading,Empty,ErrorNotice,Skeleton,Status} from '../components/Primitives';
export default function Library(){
 const [search,setSearch]=useState('');const {data,error,isPending}=useQuery({queryKey:['precedents',search],queryFn:()=>api(`/precedents?search=${encodeURIComponent(search)}`)});
 return <div className="page"><PageHeading eyebrow="The case library" title="Every ruling leaves a record.">Explore finalized decisions and the interpretations they contribute to future markets.</PageHeading><label className="search-field library-search"><Search size={16}/><input aria-label="Search precedents" placeholder="Search by meaning, not just keywords" value={search} onChange={e=>setSearch(e.target.value)}/></label><div className="notice"><BookOpen size={17}/>Semantic similarity finds relevant cases. A precedent cannot rewrite an existing market’s locked rules.</div><ErrorNotice error={error}/>{isPending?<Skeleton/>:data?.records?.length?<div className="case-list">{data.records.map(p=><Link className="case-row" key={p.id} to={`/markets/${p.id}`}><div className="case-number"><BookOpen size={20}/></div><div><Status state="SETTLED"/><h3>{p.question}</h3><p>{p.spec?.outcomes?.[p.winner]||p.winner} · {p.reason?.replaceAll('_',' ').toLowerCase()}</p><span className="source-seal"><ShieldCheck size={12}/>Rules locked under {p.spec?.charter_version}</span></div><ArrowUpRight size={19}/></Link>)}</div>:<Empty title="Case law begins with the first finalized market">Completed markets will contribute their locked specifications and verified outcomes here.</Empty>}</div>;
}
