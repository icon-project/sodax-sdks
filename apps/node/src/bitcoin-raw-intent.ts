import 'dotenv/config';

import { Sodax, ChainKeys, EvmSolverService, type CreateIntentParams } from '@sodax/sdk';

// Build the createIntent CALLDATA at the low level — the cross-chain intent payload (approve +
// createIntent on the hub) that the source deposit must carry. This is chain-agnostic: it only encodes
// the EVM intent + `encodeAddress`/`getIntentRelayChainId`, so it works for Bitcoin too with NO Bound /
// Radfi session. Whether the Bitcoin deposit tx itself (a PSBT via Bound Exchange) is supported is a
// separate concern — left for later.
const srcAddress = process.env.BTC_ADDRESS ?? 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';

const sodax = new Sodax();

async function buildBitcoinCalldata() {
  const params: CreateIntentParams = {
    srcChainKey: ChainKeys.BITCOIN_MAINNET,
    dstChainKey: ChainKeys.BASE_MAINNET,
    inputToken: '0:0', // BTC on Bitcoin (8 decimals)
    outputToken: '0xdc5B4b00F98347E95b9F94911213DAB4C687e1e3',
    inputAmount: 100_000n, // sats (0.001 BTC)
    minOutputAmount: 1n,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 600),
    allowPartialFill: false,
    srcAddress,
    dstAddress: '0x1468d3529032106291433B7e9e3026dF1Ff78F31',
    data: '0x',
  };

  // 1. Derive the user's hub wallet (Sonic) from the source address — one read, no signing.
  const creatorHubWalletAddress = await sodax.hubProvider.getUserHubWalletAddress(
    srcAddress,
    ChainKeys.BITCOIN_MAINNET,
  );

  // 2. Build the intent calldata — pure encoding, no spoke deposit / Radfi / wallet.
  const [data, intent, feeAmount] = EvmSolverService.constructCreateIntentData(
    params,
    creatorHubWalletAddress,
    sodax.config,
    sodax.config.swaps.partnerFee,
  );

  console.log('hubWallet :', creatorHubWalletAddress);
  console.log('feeAmount :', feeAmount.toString());
  console.log('intent    :', {
    ...intent,
    intentId: intent.intentId.toString(),
    inputAmount: intent.inputAmount.toString(),
    minOutputAmount: intent.minOutputAmount.toString(),
    deadline: intent.deadline.toString(),
    srcChain: intent.srcChain.toString(),
    dstChain: intent.dstChain.toString(),
  });
  console.log('calldata  :', data);
  console.log(`\n✅ calldata built (${data.length} chars) — no Bound/Radfi/wallet needed`);
}

buildBitcoinCalldata();
