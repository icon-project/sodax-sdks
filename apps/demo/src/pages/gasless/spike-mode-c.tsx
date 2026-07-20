/**
 * THROWAWAY SPIKE — "Mode C": browser-wallet (MetaMask/Coinbase/Rabby) EIP-7702 smart account
 * sponsored by Pimlico via the MetaMask Delegation Toolkit.
 *
 * Purpose: empirically answer the one open feasibility question that web research could not settle —
 * once an EOA is delegated to the EIP7702StatelessDeleGator (on Base the SAME contract MetaMask's own
 * "switch to smart account" upgrade uses, 0x63c0c19a…), can the *injected* wallet SIGN a UserOperation
 * for that account, and will Pimlico SPONSOR + a bundler INCLUDE it? If yes, the full SDK "Mode C" is
 * worth building. If the injected wallet cannot sign, it is not.
 *
 * This file is intentionally self-contained (raw EIP-6963 + viem + toolkit, no dapp-kit gasless hooks)
 * so it is trivial to delete. Rendered as a section at the bottom of the /gasless page. Requires
 * VITE_PIMLICO_API_KEY (Pimlico serves both the bundler and the ERC-7677 paymaster from one v2 URL).
 * Chain: Base (8453).
 */
import React, { useCallback, useState } from 'react';
import {
  type Address,
  type EIP1193Provider,
  createPublicClient,
  createWalletClient,
  custom,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  http,
} from 'viem';
import { base } from 'viem/chains';
import { createBundlerClient, createPaymasterClient } from 'viem/account-abstraction';
import { Implementation, getDeleGatorEnvironment, toMetaMaskSmartAccount } from '@metamask/delegation-toolkit';
import { ChainKeys, useSodaxContext } from '@sodax/dapp-kit';
import { Button } from '@/components/ui/button';

const BASE_CHAIN_ID = base.id; // 8453
const USDC_BASE: Address = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const DELEGATION_PREFIX = '0xef0100';

type Announce = { info: { uuid: string; name: string; rdns: string; icon: string }; provider: EIP1193Provider };
type LogStatus = 'ok' | 'fail' | 'info';
type LogEntry = { step: string; status: LogStatus; detail: string };

/** Collect EIP-6963-announced injected wallets (MetaMask, Coinbase, Rabby, …). */
function discoverWallets(): Promise<Announce[]> {
  return new Promise(resolve => {
    const found = new Map<string, Announce>();
    const onAnnounce = (e: Event) => {
      const detail = (e as CustomEvent<Announce>).detail;
      if (detail?.info?.uuid) found.set(detail.info.uuid, detail);
    };
    window.addEventListener('eip6963:announceProvider', onAnnounce as EventListener);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    setTimeout(() => {
      window.removeEventListener('eip6963:announceProvider', onAnnounce as EventListener);
      resolve([...found.values()]);
    }, 300);
  });
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function GaslessSpikeModeC(): React.JSX.Element {
  const { sodax } = useSodaxContext();
  const [wallets, setWallets] = useState<Announce[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [running, setRunning] = useState(false);

  const push = useCallback((step: string, status: LogStatus, detail: string) => {
    setLog(prev => [...prev, { step, status, detail }]);
  }, []);

  const refreshWallets = useCallback(async () => {
    setWallets(await discoverWallets());
  }, []);

  // One-time: trigger MetaMask's own EIP-7702 upgrade by sending a no-op atomic `wallet_sendCalls`.
  // MetaMask delegates the EOA to 0x63c0c19a… (its StatelessDeleGator) to execute the atomic batch —
  // the same impl the toolkit targets. After this confirms, "Run" reaches the sponsored-send crux.
  const upgrade = useCallback(
    async (announce: Announce) => {
      setLog([]);
      setRunning(true);
      const eip1193 = announce.provider;
      try {
        const accounts = (await eip1193.request({ method: 'eth_requestAccounts' })) as string[];
        const address = getAddress(accounts[0]);
        const currentHex = (await eip1193.request({ method: 'eth_chainId' })) as string;
        if (Number.parseInt(currentHex, 16) !== BASE_CHAIN_ID) {
          await eip1193.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: `0x${BASE_CHAIN_ID.toString(16)}` }],
          });
        }
        const walletClient = createWalletClient({ account: address, chain: base, transport: custom(eip1193) });
        // A LONE call is trivially atomic → MetaMask sends a normal tx and never upgrades. Force a genuine
        // 2-call atomic batch (two harmless approve(0)), which a plain EOA cannot do without 7702-delegating.
        const approveData = encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [address, 0n] });
        push(
          'upgrade',
          'info',
          'sending a 2-call atomic wallet_sendCalls — confirm the smart-account upgrade in your wallet…',
        );
        const { id } = await walletClient.sendCalls({
          calls: [
            { to: USDC_BASE, data: approveData },
            { to: USDC_BASE, data: approveData },
          ],
          forceAtomic: true,
        });
        const status = await walletClient.waitForCallsStatus({ id });
        const publicClient = createPublicClient({ chain: base, transport: http() });
        const code = await publicClient.getCode({ address });
        const delegatedTo =
          code?.slice(0, 8).toLowerCase() === DELEGATION_PREFIX ? getAddress(`0x${code.slice(8)}`) : undefined;
        push(
          'upgrade',
          delegatedTo ? 'ok' : 'fail',
          delegatedTo
            ? `status=${status.status} · now delegated to ${delegatedTo} — click "Run" next.`
            : `status=${status.status} but EOA code is "${code ?? '0x'}" (no 0xef0100 delegation — upgrade did not stick).`,
        );
      } catch (e) {
        push('upgrade', 'fail', e instanceof Error ? `${e.name}: ${e.message}` : String(e));
      } finally {
        setRunning(false);
      }
    },
    [push],
  );

  const run = useCallback(
    async (announce: Announce) => {
      setLog([]);
      setRunning(true);
      const eip1193 = announce.provider;
      try {
        const pimlicoApiKey = import.meta.env.VITE_PIMLICO_API_KEY as string | undefined;
        if (!pimlicoApiKey) {
          push('config', 'fail', 'VITE_PIMLICO_API_KEY is not set — the spike needs Pimlico for bundler + paymaster.');
          return;
        }
        const pimlicoUrl = `https://api.pimlico.io/v2/${BASE_CHAIN_ID}/rpc?apikey=${pimlicoApiKey}`;

        // 1. Connect + address
        const accounts = (await eip1193.request({ method: 'eth_requestAccounts' })) as string[];
        const address = getAddress(accounts[0]);
        push('1. connect', 'ok', `${announce.info.name} → ${short(address)}`);

        // 2. Ensure Base
        const currentHex = (await eip1193.request({ method: 'eth_chainId' })) as string;
        if (Number.parseInt(currentHex, 16) !== BASE_CHAIN_ID) {
          await eip1193.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: `0x${BASE_CHAIN_ID.toString(16)}` }],
          });
        }
        push('2. chain', 'ok', `on Base (${BASE_CHAIN_ID})`);

        // 3. viem clients (public = RPC, wallet = injected/JSON-RPC account)
        const publicClient = createPublicClient({ chain: base, transport: http() });
        const walletClient = createWalletClient({ account: address, chain: base, transport: custom(eip1193) });
        push('3. clients', 'ok', 'publicClient (http) + walletClient (injected custom transport)');

        // 4. Toolkit environment → the 7702 delegator implementation address
        const env = getDeleGatorEnvironment(BASE_CHAIN_ID);
        const implAddress = env.implementations.EIP7702StatelessDeleGatorImpl as Address | undefined;
        push(
          '4. environment',
          implAddress ? 'ok' : 'fail',
          implAddress
            ? `EIP7702StatelessDeleGatorImpl = ${implAddress} · keys: ${Object.keys(env.implementations).join(', ')}`
            : `no EIP7702StatelessDeleGatorImpl · keys: ${Object.keys(env.implementations).join(', ')}`,
        );
        if (!implAddress) return;

        // 5. On-chain delegation state — is the EOA already a StatelessDeleGator smart account?
        const code = await publicClient.getCode({ address });
        let delegatedTo: Address | undefined;
        if (code && code.slice(0, 8).toLowerCase() === DELEGATION_PREFIX) {
          delegatedTo = getAddress(`0x${code.slice(8)}`);
        }
        const alreadyDelegated = delegatedTo?.toLowerCase() === implAddress.toLowerCase();
        push(
          '5. delegation',
          alreadyDelegated ? 'ok' : 'info',
          alreadyDelegated
            ? `already delegated to the toolkit impl (${short(implAddress)}) — no authorization needed`
            : delegatedTo
              ? `delegated to a DIFFERENT contract (${delegatedTo}) — not the toolkit impl`
              : 'not delegated (plain EOA). Upgrade via your wallet UI ("smart account") then re-run, OR the spike will attempt a dApp authorization next (expected to fail for injected wallets).',
        );

        // 6. Build the MetaMask smart account bound to the EOA, signed by the injected wallet
        const smartAccount = await toMetaMaskSmartAccount({
          // Spike-only: pnpm resolves two structurally-identical viem@2.45.1 peer variants (demo vs toolkit),
          // so TS treats their PublicClient types as unrelated. Pin to the toolkit's own expected type.
          client: publicClient as Parameters<typeof toMetaMaskSmartAccount>[0]['client'],
          implementation: Implementation.Stateless7702,
          address,
          signer: { walletClient },
        });
        push('6. smart account', 'ok', `toMetaMaskSmartAccount(Stateless7702) bound to ${short(address)}`);

        // 7. Calls — minimal, safe: approve(0) of USDC to the SODAX assetManager (real flow batches [approve, transfer]).
        const assetManager = getAddress(
          sodax.config.getChainConfig(ChainKeys.BASE_MAINNET).addresses.assetManager as string,
        );
        const approveData = encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [assetManager, 0n] });
        const calls = [{ to: USDC_BASE, data: approveData, value: 0n }];
        push('7. calls', 'ok', `[approve(USDC, assetManager ${short(assetManager)}, 0)]`);

        // 8. Pimlico bundler + paymaster (one v2 URL serves both)
        const paymaster = createPaymasterClient({ transport: http(pimlicoUrl) });
        const bundlerClient = createBundlerClient({
          account: smartAccount,
          client: publicClient,
          transport: http(pimlicoUrl),
          paymaster,
        });
        push('8. pimlico', 'ok', 'bundler + paymaster clients ready');

        // 9. If not yet delegated, a UserOp needs a 7702 authorization. Injected wallets cannot sign one
        //    (viem: signAuthorization does not support JSON-RPC accounts) — attempt it to confirm, and stop.
        let authorization: Awaited<ReturnType<typeof walletClient.signAuthorization>> | undefined;
        if (!alreadyDelegated) {
          try {
            authorization = await walletClient.signAuthorization({ account: address, contractAddress: implAddress });
            push('9. authorization', 'ok', 'UNEXPECTED: injected wallet signed a 7702 authorization');
          } catch (e) {
            push(
              '9. authorization',
              'fail',
              `injected wallet cannot sign a 7702 authorization → upgrade via the wallet UI first, then re-run. (${e instanceof Error ? e.message : String(e)})`,
            );
            return;
          }
        }

        // 10. THE CRUX — sign the UserOp with the injected wallet + Pimlico sponsorship, submit via bundler.
        push('10. sendUserOperation', 'info', 'requesting signature from the wallet + Pimlico sponsorship…');
        const hash = await bundlerClient.sendUserOperation({
          account: smartAccount,
          calls,
          ...(authorization ? { authorization } : {}),
        });
        push('10. sendUserOperation', 'ok', `userOpHash = ${hash}`);

        const receipt = await bundlerClient.waitForUserOperationReceipt({ hash });
        push(
          '11. receipt',
          receipt.success ? 'ok' : 'fail',
          `success=${receipt.success} · tx=${receipt.receipt.transactionHash} · gasUsed=${receipt.actualGasUsed}`,
        );
        push(
          'RESULT',
          receipt.success ? 'ok' : 'fail',
          receipt.success
            ? 'FEASIBLE: injected wallet signed a Pimlico-sponsored UserOp for its 7702 smart account. Mode C is buildable.'
            : 'UserOp was included but reverted — inspect the receipt.',
        );
      } catch (e) {
        push('ERROR', 'fail', e instanceof Error ? `${e.name}: ${e.message}` : String(e));
      } finally {
        setRunning(false);
      }
    },
    [push, sodax],
  );

  const color = (s: LogStatus) =>
    s === 'ok' ? 'text-green-600' : s === 'fail' ? 'text-red-600' : 'text-muted-foreground';

  return (
    <div className="mx-auto mt-4 max-w-3xl space-y-4 border-t p-6 pt-8">
      <div>
        <h2 className="text-xl font-semibold">Gasless spike — Mode C (EIP-7702 smart account + Pimlico)</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Throwaway PoC on Base. For the sponsored-send test to reach step 10, first upgrade your wallet to a smart
          account (MetaMask → account menu → "Switch to smart account"), which delegates your EOA to{' '}
          <code>0x63c0c19a…</code> — the same contract this toolkit targets. Then pick your wallet below.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={refreshWallets}>
          Discover wallets
        </Button>
        {wallets.map(w => (
          <span key={w.info.uuid} className="flex gap-1">
            <Button variant="outline" size="sm" disabled={running} onClick={() => upgrade(w)}>
              Upgrade {w.info.name}
            </Button>
            <Button size="sm" disabled={running} onClick={() => run(w)}>
              Run with {w.info.name}
            </Button>
          </span>
        ))}
        {wallets.length === 0 ? <span className="text-sm text-muted-foreground">no wallets discovered yet</span> : null}
      </div>

      <ol className="space-y-1 rounded border p-3 text-sm">
        {log.length === 0 ? (
          <li className="text-muted-foreground">Run the spike to see step-by-step results.</li>
        ) : null}
        {log.map((e, i) => (
          <li key={i} className={color(e.status)}>
            <b>{e.step}:</b> {e.detail}
          </li>
        ))}
      </ol>
    </div>
  );
}
