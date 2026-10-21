const terminalStates=new Set(['FINALIZED','UNDETERMINED','CANCELED','CANCELLED','LEADER_TIMEOUT','VALIDATORS_TIMEOUT']);
export function transactionTerminal(data) {return !!data?.finalized||terminalStates.has(data?.status);}
export function transactionMessage(data,error) {
  if(error)return 'Tracking unavailable; your transaction hash is saved.';
  if(data?.successful)return data.finalized?'Finalized successfully':'Accepted successfully · awaiting finality';
  if(['CANCELED','CANCELLED'].includes(data?.status))return 'Transaction cancelled · state was not applied';
  if(['LEADER_TIMEOUT','VALIDATORS_TIMEOUT'].includes(data?.status))return 'Network processing timed out · inspect the saved transaction';
  if(data?.status==='UNDETERMINED')return 'Consensus was undetermined · inspect the saved transaction';
  if(data?.finalized&&data?.consensus&&!['MAJORITY_AGREE','AGREE'].includes(data.consensus))return 'Validators rejected the result · state was not applied';
  if(['ACCEPTED','FINALIZED'].includes(data?.status)&&data?.execution&&!['SUCCESS','FINISHED_WITH_RETURN'].includes(data.execution))return 'Contract execution failed';
  return data?.status?`${data.status} · awaiting validator consensus`:'Awaiting consensus';
}
