import React from 'react';
import {Link} from 'react-router-dom';
import {ArrowUpRight,Bookmark,GitBranch} from 'lucide-react';
import {Status,SourceSeal,TimeBadge} from './Primitives';
import {formatGen,percent,date} from '../api';
const art={commitment:'launch',numeric:'market',event:'world'};
export default function MarketCard({market:m,featured=false,saved=false,onSave}){
 const spec=m.spec;const p=m.prices_bps||[];
 return <article className={`market-card ${featured?'featured':''}`}><Link to={`/markets/${m.market_id}`} className={`market-art art-${m.art||art[spec.kind]}`} aria-label={spec.question}><div className="art-orbit"/><div className="art-line"/><div className="art-label">{m.topic||spec.kind}</div><div className="art-symbol">{(m.symbol||(spec.kind==='commitment'?'V':'↗'))}</div><Status state={m.state}/></Link><div className="market-card-body"><div className="card-category"><span>{spec.kind==='commitment'?'Commitment':spec.kind==='numeric'?'Numbers & signals':'World events'}</span><button className={`icon-button bookmark ${saved?'saved':''}`} onClick={()=>onSave?.(m.market_id)} aria-label={saved?'Remove from watchlist':'Save to watchlist'}><Bookmark size={15} fill={saved?'currentColor':'none'}/></button></div><Link to={`/markets/${m.market_id}`} className="card-question">{spec.question}</Link><div className="card-prices">{spec.outcomes.slice(0,3).map((o,i)=><div key={o} className={`outcome-chip outcome-${i}`}><span>{o}</span><strong>{percent(p[i])}</strong></div>)}</div><div className="card-meta"><span>{formatGen(m.volume_wei,1)} GEN volume</span><TimeBadge time={date(spec.close_time)}/></div><div className="card-evidence"><SourceSeal count={spec.sources?.length} policy={spec.source_policy}/>{spec.condition?<span className="condition-badge"><GitBranch size={12}/>Conditional</span>:<span className="card-arrow"><ArrowUpRight size={15}/></span>}</div></div></article>;
}
