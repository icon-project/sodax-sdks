// Equivalent of near-api-js JsonRpcProvider.callFunction (the only NEAR lib call the SDK makes).
export async function callFunction(rpcUrl, { contractId, method, args }) {
  const argsBase64 = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(args ?? {}))));
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'sodax',
      method: 'query',
      params: {
        request_type: 'call_function',
        finality: 'final',
        account_id: contractId,
        method_name: method,
        args_base64: argsBase64,
      },
    }),
  });
  const body = await res.json();
  if (body.error || body.result?.error) throw new Error(JSON.stringify(body.error ?? body.result.error));
  return JSON.parse(new TextDecoder().decode(new Uint8Array(body.result.result)));
}
