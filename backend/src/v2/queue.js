// A saved but unresolved broadcast blocks further automated writes to its
// contract. Retained-deployment transactions must not block the active market.
export async function pendingBroadcasts(sql,config) {
  return sql`SELECT tx_hash,method,body->>'status' AS status,updated_at FROM v2_transactions t WHERE network=${config.network} AND (lower(contract)=${config.contracts.market.toLowerCase()} OR lower(body#>>'{raw,to_address}')=${config.contracts.market.toLowerCase()} OR EXISTS(SELECT 1 FROM v2_jobs j WHERE j.payload->>'submitted_hash'=t.tx_hash AND lower(j.payload->>'contract')=${config.contracts.market.toLowerCase()})) AND COALESCE(body->>'status','PENDING') NOT IN ('ACCEPTED','FINALIZED','UNDETERMINED','CANCELED','CANCELLED','LEADER_TIMEOUT','VALIDATORS_TIMEOUT') ORDER BY updated_at LIMIT 10`;
}
