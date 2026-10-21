export type Wei = string;
export type CriterionDecision = 'MET' | 'UNMET' | 'INSUFFICIENT';
export type MarketState = 'OPEN' | 'CLOSED' | 'AWAITING_EVIDENCE' | 'PROVISIONAL' | 'CHALLENGED' | 'APPEALED' | 'FINAL' | 'SETTLED' | 'VOID';
export interface SourceManifest { id: string; host: string; publisher_group: string; modes: ('json'|'text'|'vision')[]; historical: boolean; authoritative: boolean; }
export interface Criterion { id: string; description: string; }
export interface MarketCondition { market_id: string; outcome_index: number; }
export interface MarketSpec { schema_version: 2; question: string; kind: 'numeric'|'event'|'commitment'; outcomes: string[]; close_time: number; observation: {mode: 'AT_TIME'|'BY_DEADLINE'; start: number; end: number}; sources: {manifest_id: string; url: string; mode: 'json'|'text'|'vision'}[]; source_policy: 'AUTHORITATIVE'|'QUORUM'; quorum_k: number; criteria: Criterion[]; condition: MarketCondition|null; charter_version: string; spec_hash: string; comparator?: 'gt'|'gte'|'lt'|'lte'|'eq'; threshold?: string; units?: string; }
export interface EvidenceRecord { id: string; market_id: string; spec_hash: string; source_id: string; url: string; publisher_group: string; content_hash: string; source_index: number; record_id: string; historical_verified: boolean; negative_complete: boolean; numeric_value: string|null; observed_at: number; recorded_at: number; facts: Record<string, unknown>; criteria: {id: string; decision: CriterionDecision; citation: string}[]; }
export interface ResolutionRecord { market_id: string; revision: number; spec_hash: string; winner: number|null; reason: string; evidence_ids: string[]; criteria: {id: string; decision: CriterionDecision; description: string; citations: {id:string;group:string;citation:string}[]}[]; }
export interface TransactionOutcome { hash: string; network: string; status: string; execution: string|null; successful: boolean; finalized: boolean; }
