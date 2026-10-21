import { transactionsStatusNumberToName, executionResultNumberToName, transactionResultNumberToName } from 'genlayer-js/types';
export function outcome(tx,hash,network) {
  const status = typeof tx?.status === 'number' ? transactionsStatusNumberToName[tx.status] : tx?.statusName || tx?.status || 'PENDING';
  const receipt = tx?.consensus_data?.leader_receipt;
  const leader = Array.isArray(receipt)?receipt[0]:receipt;
  const rawExecution = tx?.txExecutionResultName ?? tx?.txExecutionResult ?? tx?.execution_result ?? tx?.executionResult ?? leader?.execution_result ?? leader?.executionResult;
  const execution = typeof rawExecution === 'number' ? executionResultNumberToName[rawExecution] : rawExecution || null;
  const normalized = String(status).toUpperCase();
  const consensus = typeof tx?.result==='number'?transactionResultNumberToName[tx.result]:tx?.result_name||tx?.resultName||null;
  const rejected=consensus && !['MAJORITY_AGREE','AGREE'].includes(consensus);
  const successful = !rejected && ['ACCEPTED','FINALIZED'].includes(normalized) && ['FINISHED_WITH_RETURN','SUCCESS'].includes(String(execution).toUpperCase());
  return {hash,network,status:normalized,execution,consensus,successful,finalized:normalized==='FINALIZED',raw:JSON.parse(JSON.stringify(tx??null,(_key,value)=>typeof value==='bigint'?value.toString():value))};
}
