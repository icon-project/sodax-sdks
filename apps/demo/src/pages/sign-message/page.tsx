import React, { useState } from 'react';
import type { ChainType } from '@sodax/dapp-kit';
import { useXAccounts, useXSignMessage } from '@sodax/wallet-sdk-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAppStore } from '@/zustand/useAppStore';

const DEFAULT_BACKEND_URL = 'http://localhost:3009/api';

const buildTermsMessage = (): string =>
  `By signing this I confirm that I have read and I agree to the terms of service and legal disclaimer provided by Sodax on ${new Date().toISOString()}`;

type CallResult = {
  signature?: string;
  signatureKind?: string;
  requestBody?: string;
  status?: number;
  response?: string;
  error?: string;
  busy?: boolean;
};

/**
 * A wallet returns base64/hex strings for most chains but raw bytes for Solana, which the register
 * API expects base58-encoded. The demo bundles no base58, so those are surfaced but not posted.
 */
function describeSignature(signature: string | Uint8Array): { value: string; kind: string; postable: boolean } {
  if (typeof signature === 'string') {
    return { value: signature, kind: `string (${signature.length} chars)`, postable: true };
  }
  const base64 = btoa(String.fromCharCode(...signature));
  return { value: base64, kind: `Uint8Array (${signature.length} bytes, shown base64)`, postable: false };
}

function ResultPanel({ result }: { result: CallResult }) {
  return (
    <>
      {result.error && <p className="text-sm text-red-600">{result.error}</p>}

      {result.signature && (
        <div className="space-y-1">
          <p className="text-xs text-clay">Signature — {result.signatureKind}</p>
          <pre className="text-xs bg-cream/50 p-2 rounded max-h-40 overflow-auto whitespace-pre-wrap break-all">
            {result.signature}
          </pre>
        </div>
      )}

      {result.requestBody && (
        <details>
          <summary className="text-xs text-clay cursor-pointer">Request body</summary>
          <pre className="text-xs bg-cream/50 p-2 rounded max-h-60 overflow-auto whitespace-pre-wrap break-all">
            {result.requestBody}
          </pre>
        </details>
      )}

      {result.status !== undefined && (
        <div className="space-y-1">
          <p className="text-xs text-clay">
            HTTP {result.status}
            {result.status === 200 && ' — registered'}
            {result.status === 404 && ' — not registered'}
          </p>
          <pre className="text-xs bg-cream/50 p-2 rounded max-h-60 overflow-auto whitespace-pre-wrap break-all">
            {result.response}
          </pre>
        </div>
      )}
    </>
  );
}

export default function SignMessagePage() {
  const xAccounts = useXAccounts();
  const { mutateAsync: signMessage } = useXSignMessage();
  const openWalletModal = useAppStore(state => state.openWalletModal);

  const [backendUrl, setBackendUrl] = useState(DEFAULT_BACKEND_URL);
  const [message, setMessage] = useState(buildTermsMessage);
  const [results, setResults] = useState<Partial<Record<ChainType, CallResult>>>({});

  const [lookupAddress, setLookupAddress] = useState('');
  const [lookupChain, setLookupChain] = useState<ChainType>('SUI');
  const [lookupResult, setLookupResult] = useState<CallResult>({});

  // Every enabled chain is listed, connected or not, so an unconnected chain is still discoverable.
  const chains = Object.keys(xAccounts) as ChainType[];

  const update = (chainType: ChainType, patch: CallResult): void => {
    setResults(previous => ({ ...previous, [chainType]: { ...previous[chainType], ...patch } }));
  };

  const checkUser = async (address: string, chainType: ChainType): Promise<CallResult> => {
    try {
      const response = await fetch(`${backendUrl}/users/${address}/chain/${chainType}`);
      return { busy: false, status: response.status, response: await response.text() };
    } catch (error) {
      return { busy: false, error: error instanceof Error ? error.message : String(error) };
    }
  };

  const handleSign = async (chainType: ChainType, alsoRegister: boolean): Promise<void> => {
    const address = xAccounts[chainType]?.address;
    if (!address) return;

    update(chainType, { busy: true, error: undefined, status: undefined, response: undefined });
    try {
      const signed = await signMessage({ xChainType: chainType, message });
      if (!signed) {
        update(chainType, { busy: false, error: `${chainType} does not implement signMessage` });
        return;
      }

      const { value, kind, postable } = describeSignature(signed);
      const body = JSON.stringify({ address, signature: value, message, chain: chainType }, null, 2);
      update(chainType, { signature: value, signatureKind: kind, requestBody: body });

      if (!alsoRegister) {
        update(chainType, { busy: false });
        return;
      }
      if (!postable) {
        update(chainType, { busy: false, error: 'Raw-byte signatures need base58 before the register call' });
        return;
      }

      const response = await fetch(`${backendUrl}/users/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, signature: value, message, chain: chainType }),
      });
      update(chainType, { busy: false, status: response.status, response: await response.text() });
    } catch (error) {
      update(chainType, { busy: false, error: error instanceof Error ? error.message : String(error) });
    }
  };

  const handleCheckConnected = async (chainType: ChainType): Promise<void> => {
    const address = xAccounts[chainType]?.address;
    if (!address) return;
    update(chainType, { busy: true, error: undefined });
    update(chainType, await checkUser(address, chainType));
  };

  const handleLookup = async (): Promise<void> => {
    const address = lookupAddress.trim();
    if (!address) return;
    setLookupResult({ busy: true });
    setLookupResult(await checkUser(address, lookupChain));
  };

  return (
    <div className="container mx-auto px-4 py-8 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Sign message</CardTitle>
          <CardDescription>
            Signs with each connected wallet via <code>useXSignMessage</code> and optionally posts the result to a
            stateful-api <code>/users/register</code>. Sui accounts created through social login produce a zkLogin
            signature, which the backend can only verify against a Sui node.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="message">Message</Label>
            <Input id="message" value={message} onChange={event => setMessage(event.target.value)} />
            <Button variant="cherryOutline" size="sm" onClick={() => setMessage(buildTermsMessage())}>
              Reset timestamp
            </Button>
          </div>
          <div className="space-y-2">
            <Label htmlFor="backend">Backend base URL</Label>
            <Input id="backend" value={backendUrl} onChange={event => setBackendUrl(event.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Check user exists</CardTitle>
          <CardDescription>
            The same <code>GET /users/:address/chain/:chain</code> the frontend&apos;s <code>isRegisteredUser</code>{' '}
            calls. Takes any address, so no wallet connection is needed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[320px] space-y-2">
              <Label htmlFor="lookup-address">Address</Label>
              <Input
                id="lookup-address"
                placeholder="0x…"
                value={lookupAddress}
                onChange={event => setLookupAddress(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lookup-chain">Chain</Label>
              <select
                id="lookup-chain"
                className="h-9 rounded-md border border-cherry-grey/40 bg-white px-3 text-sm"
                value={lookupChain}
                onChange={event => setLookupChain(event.target.value as ChainType)}
              >
                {chains.map(chainType => (
                  <option key={chainType} value={chainType}>
                    {chainType}
                  </option>
                ))}
              </select>
            </div>
            <Button disabled={lookupResult.busy || !lookupAddress.trim()} onClick={handleLookup}>
              Check
            </Button>
          </div>
          <ResultPanel result={lookupResult} />
        </CardContent>
      </Card>

      {chains.map(chainType => {
        const address = xAccounts[chainType]?.address;
        const result = results[chainType] ?? {};
        const disabled = result.busy || !address;
        return (
          <Card key={chainType}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-4">
                <span>{chainType}</span>
                {address ? (
                  <code className="text-xs font-mono text-clay break-all">{address}</code>
                ) : (
                  <button type="button" className="text-xs text-clay underline" onClick={openWalletModal}>
                    not connected
                  </button>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Button disabled={disabled} onClick={() => handleSign(chainType, false)}>
                  Sign
                </Button>
                <Button disabled={disabled} onClick={() => handleSign(chainType, true)}>
                  Sign &amp; register
                </Button>
                <Button variant="cherryOutline" disabled={disabled} onClick={() => handleCheckConnected(chainType)}>
                  Check registration
                </Button>
                <Button
                  variant="cherryOutline"
                  disabled={!address}
                  onClick={() => {
                    setLookupAddress(address ?? '');
                    setLookupChain(chainType);
                  }}
                >
                  Copy to lookup
                </Button>
              </div>
              <ResultPanel result={result} />
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
