/**
 * Full SDK swap flow: connect → switch chain → swap.
 * Demonstrates wiring useWalletProvider into a @sodax/sdk call.
 *
 * Requires also:  pnpm add @sodax/sdk
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  SodaxWalletProvider,
  type SodaxWalletConfig,
  useXAccount,
  useXConnect,
  useXConnectors,
  useXDisconnect,
  useWalletProvider,
  useEvmSwitchChain,
} from '@sodax/wallet-sdk-react';
import { ChainKeys } from '@sodax/types';
import { Sodax } from '@sodax/sdk';
import type { CreateIntentParams } from '@sodax/sdk';

const queryClient = new QueryClient();

const walletConfig: SodaxWalletConfig = {
  EVM: {
    chains: {
      [ChainKeys.SONIC_MAINNET]: { rpcUrl: 'https://rpc.soniclabs.com' },
      [ChainKeys.BSC_MAINNET]: { rpcUrl: 'https://bsc-dataseed.binance.org' },
    },
  },
};

const sodax = new Sodax();

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SodaxWalletProvider config={walletConfig}>
        <SwapFlow />
      </SodaxWalletProvider>
    </QueryClientProvider>
  );
}

const SRC_CHAIN = ChainKeys.BSC_MAINNET;

function SwapFlow() {
  const account = useXAccount({ xChainId: SRC_CHAIN });
  const walletProvider = useWalletProvider({ xChainId: SRC_CHAIN });
  const { isWrongChain, handleSwitchChain } = useEvmSwitchChain({ xChainId: SRC_CHAIN });

  // 1. Not connected → show connect UI
  if (!account.address) return <ConnectButton />;

  // 2. Connected but wrong network → show switch CTA
  if (isWrongChain) {
    return <button onClick={handleSwitchChain}>Switch to BSC</button>;
  }

  // 3. Ready to swap
  return <SwapButton walletProvider={walletProvider} />;
}

function SwapButton({ walletProvider }: { walletProvider: ReturnType<typeof useWalletProvider> }) {
  const handleSwap = async () => {
    if (!walletProvider) return;

    const params: CreateIntentParams<typeof SRC_CHAIN> = {
      srcChainKey: SRC_CHAIN,
      // Fill in the rest from your form / token selector:
      // dstChainKey, srcAsset, dstAsset, amountIn, etc.
    } as CreateIntentParams<typeof SRC_CHAIN>;

    const result = await sodax.swaps.swap({ params, walletProvider });

    if (!result.ok) {
      console.error('swap failed:', result.error);
      return;
    }

    console.log('swap submitted:', result.value);
  };

  return <button onClick={handleSwap}>Swap on BSC</button>;
}

function ConnectButton() {
  const connectors = useXConnectors({ xChainType: 'EVM' });
  const { mutateAsync: connect, isPending } = useXConnect();
  const account = useXAccount({ xChainType: 'EVM' });
  const disconnect = useXDisconnect();

  if (account.address) {
    return (
      <div>
        <code>{account.address}</code>
        <button onClick={() => disconnect({ xChainType: 'EVM' })}>Disconnect</button>
      </div>
    );
  }

  return (
    <div>
      {connectors.map((connector) => (
        <button
          key={connector.id}
          onClick={() => connect(connector).catch(() => {})}
          disabled={isPending || !connector.isInstalled}
        >
          {connector.name}
        </button>
      ))}
    </div>
  );
}
