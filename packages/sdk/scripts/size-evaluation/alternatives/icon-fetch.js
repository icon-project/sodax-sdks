// Equivalent of the icon-sdk-js surface the SDK uses (IconService/HttpProvider JSON-RPC calls, CallBuilder,
// CallTransactionBuilder, Converter.toRawTransaction/toHex/toBigNumber) as a thin fetch-based client.
const toHex = v => (typeof v === 'string' && v.startsWith('0x') ? v : `0x${BigInt(v).toString(16)}`);
async function rpc(url, method, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${body.error.code}: ${body.error.message}`);
  return body.result;
}
export class IconRpc {
  constructor(url) {
    this.url = url;
  }
  getBalance(address) {
    return rpc(this.url, 'icx_getBalance', { address }).then(BigInt);
  }
  call({ to, method, params, from }) {
    return rpc(this.url, 'icx_call', { to, from, dataType: 'call', data: { method, params } });
  }
  getTransactionResult(txHash) {
    return rpc(this.url, 'icx_getTransactionResult', { txHash });
  }
}
export function buildCallTx({ from, to, nid, stepLimit, value, method, params }) {
  const tx = {
    version: '0x3',
    from,
    to,
    nid: toHex(nid),
    stepLimit: toHex(stepLimit),
    timestamp: toHex(Date.now() * 1000),
    dataType: 'call',
    data: { method, params },
  };
  if (value) tx.value = toHex(value);
  return tx;
}
export const toRawTransaction = tx => JSON.parse(JSON.stringify(tx, (_, v) => (typeof v === 'bigint' ? toHex(v) : v)));
export { toHex };
export const toBigNumber = v => BigInt(v);
