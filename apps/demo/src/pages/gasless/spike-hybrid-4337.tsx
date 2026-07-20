/**
 * THROWAWAY SPIKE — "Hybrid 4337": a SEPARATE ERC-4337 MetaMask smart account (address ≠ the EOA),
 * owned/controlled by the connected injected MetaMask EOA, sponsored by Pimlico. Deliberately isolated
 * from the same-address EIP-7702 "Mode C" spike (spike-mode-c.tsx) — this proves a DIFFERENT path.
 *
 * Why this can work where the same-address 7702 path failed:
 *  - Hybrid is a separately-DEPLOYED 4337 account (via the toolkit SimpleFactory), so there is NO
 *    EIP-7702 authorization to sign (the `signAuthorization`-not-for-JSON-RPC wall does not apply).
 *  - The owner signs the UserOp as EIP-712 typed data whose `verifyingContract` is the SMART-ACCOUNT
 *    address (not the EOA), so MetaMask's "external signature requests cannot use internal accounts as
 *    the verifying contract" guard (which killed Mode C) should NOT fire — `eth_signTypedData_v4` is
 *    permitted. This spike verifies that empirically.
 *
 * KEY LIMITATION (by design): the smart account has a DIFFERENT address from the EOA, so the user's
 * existing token balances / allowances on the EOA are NOT available to it. A real SODAX deposit from
 * this account would need the tokens funded to / approved for the smart-account address first.
 *
 * Self-contained (raw EIP-6963 + viem + toolkit, no dapp-kit hooks) so it is trivial to delete.
 * Rendered as a section on the /gasless page, below the Mode C spike. Chain: Base (8453). Requires
 * VITE_PIMLICO_API_KEY — and, for mainnet sponsorship to succeed, a FUNDED Pimlico sponsorship policy.
 */
import React, { useCallback, useState } from 'react';
import {
  type Address,
  type EIP1193Provider,
  type Hex,
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
import { Implementation, toMetaMaskSmartAccount } from '@metamask/delegation-toolkit';
import { ChainKeys, useSodaxContext } from '@sodax/dapp-kit';
import { Button } from '@/components/ui/button';

const BASE_CHAIN_ID = base.id; // 8453
const USDC_BASE: Address = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

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

export function GaslessSpikeHybrid4337(): React.JSX.Element {
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

  const run = useCallback(
    async (announce: Announce) => {
      setLog([]);
      setRunning(true);
      const eip1193 = announce.provider;
      try {
        const pimlicoApiKey = import.meta.env.VITE_PIMLICO_API_KEY as string | undefined;
        if (!pimlicoApiKey) {
          push('config', 'fail', 'VITE_PIMLICO_API_KEY is not set — needed for the Pimlico bundler + paymaster.');
          return;
        }
        const pimlicoUrl = `https://api.pimlico.io/v2/${BASE_CHAIN_ID}/rpc?apikey=${pimlicoApiKey}`;

        // 1. Connect the injected wallet — obtain the owner EOA. No private key is ever accessed.
        const accounts = (await eip1193.request({ method: 'eth_requestAccounts' })) as string[];
        const owner = getAddress(accounts[0]);
        push('1. connect', 'ok', `${announce.info.name} → owner EOA ${short(owner)}`);

        // 2. Ensure Base.
        const currentHex = (await eip1193.request({ method: 'eth_chainId' })) as string;
        if (Number.parseInt(currentHex, 16) !== BASE_CHAIN_ID) {
          await eip1193.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: `0x${BASE_CHAIN_ID.toString(16)}` }],
          });
        }
        push('2. chain', 'ok', `on Base (${BASE_CHAIN_ID})`);

        // 3. viem clients — public = RPC read; wallet = injected/JSON-RPC signer (no private key in the app).
        const publicClient = createPublicClient({ chain: base, transport: http() });
        const walletClient = createWalletClient({ account: owner, chain: base, transport: custom(eip1193) });
        push('3. clients', 'ok', 'publicClient (http) + injected walletClient — NO private key used');

        // 4. Deterministic Hybrid 4337 smart account, owner = the connected EOA, signer = injected wallet.
        const smartAccount = await toMetaMaskSmartAccount({
          // Spike-only cast: pnpm resolves two structurally-identical viem@2.45.1 peer variants (demo vs
          // toolkit), so TS sees their PublicClient types as unrelated. Pin to the toolkit's expected type.
          client: publicClient as Parameters<typeof toMetaMaskSmartAccount>[0]['client'],
          implementation: Implementation.Hybrid,
          deployParams: [owner, [], [], []], // [owner, keyIds, xValues, yValues] — EOA owner, no passkeys
          deploySalt: '0x',
          signer: { walletClient },
        });
        push('4. smart account', 'ok', `Hybrid 4337 account ${smartAccount.address}`);

        // 5. Confirm the smart-account address is SEPARATE from the owner EOA.
        const separate = smartAccount.address.toLowerCase() !== owner.toLowerCase();
        push(
          '5. address check',
          separate ? 'ok' : 'fail',
          separate
            ? `smart account ${short(smartAccount.address)} ≠ owner EOA ${short(owner)} ✓`
            : 'UNEXPECTED: smart-account address equals the owner EOA',
        );
        if (!separate) return;

        // 6. Pimlico bundler + verifying paymaster (one v2 URL serves both).
        const paymaster = createPaymasterClient({ transport: http(pimlicoUrl) });
        const bundlerClient = createBundlerClient({
          account: smartAccount,
          client: publicClient,
          transport: http(pimlicoUrl),
          paymaster,
        });
        push('6. pimlico', 'ok', 'bundler + verifying paymaster ready');

        // 7. The required [approve, transfer] batch — 0-amount so no smart-account funding is needed to
        //    prove execution + sponsorship (a real deposit uses non-zero amounts on a funded account).
        const assetManager = getAddress(
          sodax.config.getChainConfig(ChainKeys.BASE_MAINNET).addresses.assetManager as string,
        );
        const approveData = encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [assetManager, 0n] });
        const transferData = encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [assetManager, 0n] });
        const calls: { to: Address; data: Hex }[] = [
          { to: USDC_BASE, data: approveData },
          { to: USDC_BASE, data: transferData },
        ];
        push('7. calls', 'ok', `[approve(USDC,0), transfer(USDC,0)] → assetManager ${short(assetManager)}`);

        // 8. Send — Smart Accounts Kit requests the OWNER signature via injected MetaMask (eth_signTypedData_v4,
        //    verifyingContract = the smart account) and Pimlico sponsors. This is the crux.
        push('8. sendUserOperation', 'info', 'MetaMask should prompt to SIGN typed data (not a tx) — approve it…');
        const hash = await bundlerClient.sendUserOperation({ account: smartAccount, calls });
        push('8. sendUserOperation', 'ok', `userOpHash = ${hash}`);

        // 9. Receipt — verify sender = smart account, Pimlico paid, calls executed.
        const receipt = await bundlerClient.waitForUserOperationReceipt({ hash });
        const senderMatch = receipt.sender?.toLowerCase() === smartAccount.address.toLowerCase();
        push(
          '9. receipt',
          receipt.success ? 'ok' : 'fail',
          `success=${receipt.success} · sender=${receipt.sender} · tx=${receipt.receipt.transactionHash}`,
        );
        push(
          '   sender check',
          senderMatch ? 'ok' : 'fail',
          senderMatch ? 'UserOp sender = smart account ✓' : 'sender ≠ smart account',
        );
        push(
          '   sponsorship',
          receipt.paymaster ? 'ok' : 'info',
          `paymaster=${receipt.paymaster ?? 'n/a'} · actualGasCost=${receipt.actualGasCost} · gasUsed=${receipt.actualGasUsed}`,
        );
        push(
          'RESULT',
          receipt.success ? 'ok' : 'fail',
          receipt.success
            ? 'FEASIBLE: injected MetaMask signed a Pimlico-sponsored UserOp for a SEPARATE Hybrid 4337 account.'
            : 'UserOp was included but reverted — inspect the tx.',
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
    <div className="mx-auto mt-6 max-w-3xl space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Spike — Hybrid 4337 (separate smart account + Pimlico)</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Proves whether the injected MetaMask can sign a Pimlico-sponsored UserOperation for a <b>separate</b> ERC-4337
          smart account (address ≠ your EOA) that it owns — the path that sidesteps the same-address 7702 signing block.
          On Base; needs a funded Pimlico sponsorship policy.
        </p>
        <p className="mt-2 rounded border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
          Limitation: this smart account has a <b>different address</b> from your EOA. Your existing USDC and allowances
          on the EOA are <b>not</b> here — a real deposit would require funding/approving this address first.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={refreshWallets}>
          Discover wallets
        </Button>
        {wallets.map(w => (
          <Button key={w.info.uuid} size="sm" disabled={running} onClick={() => run(w)}>
            Run with {w.info.name}
          </Button>
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
