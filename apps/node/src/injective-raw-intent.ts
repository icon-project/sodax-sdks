import 'dotenv/config';

import { Sodax, ChainKeys } from '@sodax/sdk';

// Injective createIntent in raw mode — same idea as stacks-raw-intent.ts: build the unsigned source tx
// with the SDK (the path the Swaps API backend uses). NO private key / wallet needed — Injective reads
// the signer public key from the on-chain account (so the address must have signed at least once), then
// builds the unsigned Cosmos SignDoc (bodyBytes + authInfoBytes). raw=true returns it, no broadcast.
//
// The fallback is a public mainnet address (not under the team's control) that has signed before, so the
// on-chain pubkey lookup in getRawTransaction succeeds. Override with INJ_ADDRESS to use your own.
const srcAddress = process.env.INJ_ADDRESS ?? 'inj10ch5tlensr62n3fhgz4xecavgjnffu8p5z7f5y';

const sodax = new Sodax();

async function testInjectiveRawIntent() {
  console.log('srcAddress :', srcAddress);

  const result = await sodax.swaps.createIntent({
    params: {
      srcChainKey: ChainKeys.INJECTIVE_MAINNET,
      dstChainKey: ChainKeys.BASE_MAINNET,
      inputToken: 'inj', // native INJ (18 decimals)
      outputToken: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC on Base
      inputAmount: 100_000_000_000_000_000n, // 0.1 INJ
      minOutputAmount: 1n, // any — fillability isn't checked at build time
      deadline: BigInt(Math.floor(Date.now() / 1000) + 600),
      allowPartialFill: false,
      srcAddress,
      dstAddress: '0x04fB32A76bdF59fC8815e2850653130e82445b63',
      data: '0x',
    },
    raw: true,
  });

  if (!result.ok) {
    console.error('❌ createIntent FAILED:', result.error);
    process.exit(1);
  }

  const { tx } = result.value;
  console.log('✅ raw tx :', tx); // { from, to, signedDoc: { bodyBytes, authInfoBytes, chainId, accountNumber } }

  const doc = (tx as { signedDoc?: { bodyBytes?: Uint8Array; authInfoBytes?: Uint8Array } }).signedDoc;
  if (doc?.bodyBytes?.length && doc?.authInfoBytes?.length) {
    console.log(`✅ PASS — unsigned SignDoc built (bodyBytes ${doc.bodyBytes.length} B, authInfoBytes ${doc.authInfoBytes.length} B)`);
  } else {
    console.error('❌ FAIL — no signedDoc in the raw tx');
    process.exit(1);
  }
}

testInjectiveRawIntent();
