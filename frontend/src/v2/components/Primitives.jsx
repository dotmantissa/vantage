import React from 'react';
import { AlertCircle, ArrowUpRight, ShieldCheck, Clock3 } from 'lucide-react';
export function Status({state = 'OPEN'}) { return <span className={`status status-${state.toLowerCase()}`}><span />{state.replaceAll('_',' ').toLowerCase()}</span>; }
export function ErrorNotice({error}) { return error ? <div role="alert" className="notice danger"><AlertCircle size={18}/><span>{error.message || error}</span></div> : null; }
export function Empty({title, children}) { return <div className="empty"><div className="empty-mark"><ShieldCheck size={28}/></div><h3>{title}</h3><p>{children}</p></div>; }
export function Skeleton({lines = 3}) { return <div aria-label="Loading" role="status" className="skeleton-box">{Array.from({length:lines},(_,i)=><span key={i} className="skeleton"/>)}</div>; }
export function PageHeading({eyebrow,title,children,action}) { return <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{children && <p className="lede">{children}</p>}</div>{action}</div>; }
export function SourceSeal({count,policy}) { return <span className="source-seal"><ShieldCheck size={14}/>{policy === 'AUTHORITATIVE' ? 'Primary record' : `${count || 0} evidence sources`}</span>; }
export function External({href,children}) { return <a className="external" href={href} target="_blank" rel="noreferrer">{children}<ArrowUpRight size={14}/></a>; }
export function TimeBadge({time}) { return <span className="time-badge"><Clock3 size={13}/>{time}</span>; }
