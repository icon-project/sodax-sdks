import 'dotenv/config';
import type { Address, Hex } from 'viem';
import {
  EvmAssetManagerService,
  spokeChainConfig,
  Sodax,
  encodeContractCalls,
  encodeAddress,
  type SodaxConfig,
  type AleoSpokeChainConfig,
  type SonicSpokeChainConfig,
  type DeepPartial,
  type HttpUrl,
  ChainKeys,
  HUB_CHAIN_KEY,
  getIntentRelayChainId,
} from '@sodax/sdk';
import { AleoWalletProvider } from '@sodax/wallet-sdk-core';

const ALEO_CHAIN_KEY = ChainKeys.ALEO_MAINNET;
const HUB_CHAIN_KEY_VALUE = HUB_CHAIN_KEY;
const aleoChainConfig = spokeChainConfig[ALEO_CHAIN_KEY] as AleoSpokeChainConfig;
const destinationChainConfig = spokeChainConfig[HUB_CHAIN_KEY_VALUE] as SonicSpokeChainConfig;
const ALEO_RPC_URL = process.env.ALEO_RPC_URL || aleoChainConfig.rpcUrl;
const ALEO_PRIVATE_KEY = process.env.ALEO_PRIVATE_KEY;
const PROVABLE_API_KEY = process.env.PROVABLE_API_KEY;
const PROVABLE_CONSUMER_ID = process.env.PROVABLE_CONSUMER_ID;
const HUB_RPC_URL = process.env.HUB_RPC_URL || 'https://rpc.soniclabs.com';
const RELAYER_API_ENDPOINT = process.env.RELAYER_API_ENDPOINT as HttpUrl | undefined;

if (!ALEO_PRIVATE_KEY) throw new Error('ALEO_PRIVATE_KEY is required');
if (!ALEO_PRIVATE_KEY.startsWith('APrivateKey1')) throw new Error('Invalid ALEO_PRIVATE_KEY');
if (!PROVABLE_API_KEY) throw new Error('PROVABLE_API_KEY is required');
if (!PROVABLE_CONSUMER_ID) throw new Error('PROVABLE_CONSUMER_ID is required');

const aleoWalletProvider = new AleoWalletProvider({
  type: 'privateKey',
  rpcUrl: ALEO_RPC_URL,
  privateKey: ALEO_PRIVATE_KEY,
  network: 'mainnet',
  delegate: {
    apiKey: PROVABLE_API_KEY,
    consumerId: PROVABLE_CONSUMER_ID,
  },
});

const sodaxConfigOverrides: DeepPartial<SodaxConfig> = {
  hub: { rpcUrl: HUB_RPC_URL },
  ...(RELAYER_API_ENDPOINT ? { relay: { relayerApiEndpoint: RELAYER_API_ENDPOINT } } : {}),
};

const sodax = new Sodax(sodaxConfigOverrides);
const hubProvider = sodax.hubProvider;
const aleoSpokeService = sodax.spoke.aleo;

async function submitData(tx_hash: string, address: Address, payload: Hex | null): Promise<unknown> {
  if (!RELAYER_API_ENDPOINT) {
    console.warn('RELAYER_API_ENDPOINT not set — skipping relay submission');
    return null;
  }

  const relayChainId = String(getIntentRelayChainId(ALEO_CHAIN_KEY));
  const data =
    payload == null
      ? { action: 'submit', params: { chain_id: relayChainId, tx_hash } }
      : { action: 'submit', params: { chain_id: relayChainId, tx_hash, data: { address, payload } } };

  try {
    const request = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    };
    console.log('HTTP Request:', { RELAYER_API_ENDPOINT, ...request });
    const response = await fetch(RELAYER_API_ENDPOINT, request);
    if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
    const result = await response.json();
    console.log('Response:', result);
    return result;
  } catch (error) {
    console.error('Error submitting data:', error);
    return null;
  }
}

async function getUserHubWallet(): Promise<Address> {
  const walletAddress = await aleoWalletProvider.getWalletAddress();
  console.log('WalletAddress: ', walletAddress);
  console.log('chainKey: ', ALEO_CHAIN_KEY);
  return hubProvider.getUserHubWalletAddress(walletAddress, ALEO_CHAIN_KEY);
}

async function depositTo(token: string, amount: bigint, recipient?: Address): Promise<void> {
  const walletAddress = await aleoWalletProvider.getWalletAddress();
  const userHubWallet = await getUserHubWallet();
  console.log('userHubWallet ✌️:', userHubWallet);

  const to = recipient ?? userHubWallet;
  console.log('[depositTo] to:', to);

  const txId = await aleoSpokeService.deposit<false>({
    srcChainKey: ALEO_CHAIN_KEY,
    srcAddress: walletAddress,
    to,
    token,
    amount,
    data: '0x',
    raw: false,
    walletProvider: aleoWalletProvider,
    feeAmount: BigInt(0),
  });

  const res = await submitData(txId, to, null);
  console.log(res);
  console.log('[depositTo] txId', txId);
}

async function withdrawAsset(token: string, amount: number, recipient: string): Promise<void> {
  const walletAddress = await aleoWalletProvider.getWalletAddress();
  const userHubWallet = await getUserHubWallet();

  const transferCalldata = EvmAssetManagerService.withdrawAssetData(
    {
      token,
      to: encodeAddress(ALEO_CHAIN_KEY, recipient),
      amount: BigInt(amount),
    },
    hubProvider,
    ALEO_CHAIN_KEY,
  );

  const payload = encodeContractCalls([
    { address: hubProvider.chainConfig.addresses.assetManager, value: 0n, data: transferCalldata },
  ]);

  const txId = await aleoSpokeService.sendMessage<false>({
    srcChainKey: ALEO_CHAIN_KEY,
    srcAddress: walletAddress,
    dstChainKey: HUB_CHAIN_KEY_VALUE,
    dstAddress: userHubWallet,
    payload,
    raw: false,
    walletProvider: aleoWalletProvider,
  });

  const res = await submitData(txId, userHubWallet, payload);
  console.log('Response: ', res);
  console.log('[withdrawAsset] txId', txId);
}

async function createIntent(amount: number, inputToken: string, outputToken: string): Promise<void> {
  const walletAddress = await aleoWalletProvider.getWalletAddress();
  const userHubWallet = await getUserHubWallet();

  const result = await sodax.swaps.createIntent<typeof ALEO_CHAIN_KEY, false>({
    params: {
      inputToken,
      outputToken,
      inputAmount: BigInt(amount),
      minOutputAmount: 0n,
      deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
      allowPartialFill: false,
      srcChainKey: ALEO_CHAIN_KEY,
      dstChainKey: destinationChainConfig.chain.key,
      srcAddress: walletAddress,
      dstAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      solver: '0x0000000000000000000000000000000000000000',
      data: '0x',
    },
    raw: false,
    walletProvider: aleoWalletProvider,
    skipSimulation: true,
  });

  if (!result.ok) {
    console.error('[createIntent] Failed:', result.error);
    throw new Error('createIntent failed');
  }

  const { tx: txId, intent, relayData } = result.value;
  console.log('[createIntent] txId:', txId);
  console.log('[createIntent] intentId:', intent.intentId);

  const res = await submitData(txId, userHubWallet, relayData.payload);
  console.log('[createIntent] submitData response:', res);

  console.log('[createIntent] waiting for relay execution...');
  const packetResult = await sodax.swaps.getSolvedIntentPacket({
    chainId: ALEO_CHAIN_KEY,
    fillTxHash: txId,
  });

  if (!packetResult.ok) {
    console.error('[createIntent] relay wait failed:', packetResult.error);
    throw new Error('createIntent relay failed');
  }

  const dstTxHash = packetResult.value.dst_tx_hash;
  console.log('[createIntent] relay executed, dstTxHash:', dstTxHash);

  const executionResult = await sodax.swaps.postExecution({
    intent_tx_hash: dstTxHash as `0x${string}`,
  });

  if (!executionResult.ok) {
    console.error('[createIntent] solver submission failed:', executionResult.error);
    throw new Error('createIntent solver submission failed');
  }

  console.log('[createIntent] solver response:', executionResult.value);
}

async function swap(amount: number, inputToken: string, outputToken: string): Promise<void> {
  const walletAddress = await aleoWalletProvider.getWalletAddress();
  const userHubWallet = await getUserHubWallet();

  const result = await sodax.swaps.swap({
    params: {
      inputToken,
      outputToken,
      inputAmount: BigInt(amount),
      minOutputAmount: 0n,
      deadline: 0n,
      allowPartialFill: false,
      srcChainKey: ALEO_CHAIN_KEY,
      dstChainKey: destinationChainConfig.chain.key,
      srcAddress: walletAddress,
      dstAddress: userHubWallet,
      solver: '0x0000000000000000000000000000000000000000',
      data: '0x',
    },
    walletProvider: aleoWalletProvider,
    skipSimulation: true
  });

  if (!result.ok) {
    console.error('[swap] Failed:', result.error);
    throw new Error('swap failed');
  }

  const { solverExecutionResponse, intent, intentDeliveryInfo } = result.value;
  console.log('[swap] intentId:', intent.intentId);
  console.log('[swap] srcTxHash:', intentDeliveryInfo.srcTxHash);
  console.log('[swap] dstTxHash:', intentDeliveryInfo.dstTxHash);
  console.log('[swap] solverExecutionResponse:', solverExecutionResponse);
}

async function getBalance(token: string): Promise<void> {
  const walletAddress = await aleoWalletProvider.getWalletAddress();
  const balance = await aleoSpokeService.getDeposit({
    srcChainKey: ALEO_CHAIN_KEY,
    srcAddress: walletAddress,
    token,
  });
  console.log('[getBalance] token:', token);
  console.log('[getBalance] balance:', balance.toString());
}

async function estimateGas(token: string, amount: bigint): Promise<void> {
  const walletAddress = await aleoWalletProvider.getWalletAddress();
  const userHubWallet = await getUserHubWallet();

  const rawTx = await aleoSpokeService.deposit<true>({
    srcChainKey: ALEO_CHAIN_KEY,
    srcAddress: walletAddress,
    to: userHubWallet,
    token,
    amount,
    data: '0x',
    raw: true,
  });

  const gasEstimate = await aleoSpokeService.estimateGas({ tx: rawTx, chainKey: ALEO_CHAIN_KEY });
  console.log('[estimateGas] tx:', rawTx);
  console.log('[estimateGas] gasEstimate:', gasEstimate);
}

async function main(): Promise<void> {
  const functionName = process.argv[2];

  if (functionName === 'deposit') {
    const token = process.argv[3];
    const amount = BigInt(process.argv[4]);
    const recipient = process.argv[5] as Address | undefined;
    await depositTo(token, amount, recipient);
  } else if (functionName === 'withdrawAsset') {
    const token = process.argv[3];
    const amount = Number(process.argv[4]);
    const recipient = process.argv[5];
    await withdrawAsset(token, amount, recipient);
  } else if (functionName === 'createIntent') {
    const amount = Number(process.argv[3]);
    const inputToken = process.argv[4];
    const outputToken = process.argv[5];
    await createIntent(amount, inputToken, outputToken);
  } else if (functionName === 'swap') {
    const amount = Number(process.argv[3]);
    const inputToken = process.argv[4];
    const outputToken = process.argv[5];
    await swap(amount, inputToken, outputToken);
  } else if (functionName === 'getBalance') {
    const token = process.argv[3];
    await getBalance(token);
  } else if (functionName === 'estimateGas') {
    const token = process.argv[3];
    const amount = BigInt(process.argv[4]);
    await estimateGas(token, amount);
  } else {
    console.log(
      [
        'Usage: pnpm aleo <function> [args...]',
        'Functions:',
        '  deposit <token> <amount> <recipient>             - Deposit tokens to hub',
        '  withdrawAsset <token> <amount> <recipient>       - Withdraw tokens from hub',
        '  createIntent <amount> <inputToken> <outputToken> - Create swap intent (manual relay)',
        '  swap <amount> <inputToken> <outputToken>         - Full swap (intent + relay + execute)',
        '  getBalance <token>                               - Get deposited balance for a token',
        '  estimateGas <token> <amount>                     - Estimate Aleo gas for a deposit',
      ].join('\n'),
    );
  }
}

main().catch((error: unknown) => {
  console.error('Error: ', error);
  if (error instanceof Error) console.error('Error:', error.message);
  process.exit(1);
});
