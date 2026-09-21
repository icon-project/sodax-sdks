import 'dotenv/config';

import { Sodax, ChainKeys } from '@sodax/sdk';

// NO private key needed. `raw: true` only BUILDS the unsigned source tx — nothing is signed here —
// so all it needs is the source address + the signer public key as plain strings.
//
// Where to get them without a PK:
//   - Your Stacks wallet (Leather/Xverse) returns the public key on connect (`stx_getAddresses`).
//   - In a dapp, the SDK now carries it on the connected account: `useXAccount().publicKey`.
//   - Pass them via env: SRC_ADDRESS=SP... SRC_PUBLIC_KEY=02...
//
// With no env set it runs with the sample pair below — a compressed public key and the mainnet address
// it derives to. They MUST belong to the same account: the SDK derives the address from srcPublicKey and
// rejects the call if it doesn't equal srcAddress (your wallet returns both for the same account).
const srcPublicKey = process.env.SRC_PUBLIC_KEY ?? '025259f813b57dd5c3fcac09776d767a49f6dd77bba5895823b891e31b10a96a5d';
const srcAddress = process.env.SRC_ADDRESS ?? 'SP1D5PA98M0PF9Z4Q4N2CDTMTD7XSZ6GE7QQG5XBX';

// No-arg Sodax uses the packaged static defaults (hub RPC, spoke configs, solver, relay).
const sodax = new Sodax();

/**
 * Does `createIntent({ raw: true })` produce the unsigned Stacks tx data when given the full input
 * (srcAddress = real `SP…` address + srcPublicKey = the signer public key)?
 *
 * Read-only: raw mode builds and returns the unsigned tx — it never broadcasts. Two network reads
 * happen (hub-wallet derivation + Stacks asset-manager impl lookup), so a working RPC is needed.
 */
async function testStacksRawIntent() {
  console.log('srcAddress  :', srcAddress);
  console.log('srcPublicKey:', srcPublicKey);

  const result = await sodax.swaps.createIntent({
    params: {
      srcChainKey: ChainKeys.STACKS_MAINNET,
      dstChainKey: ChainKeys.BASE_MAINNET,
      inputToken: 'SP3031RGK734636C8KGW2Y76TEQBTVX59Q472EQH0.soda',
      outputToken: '0xdc5B4b00F98347E95b9F94911213DAB4C687e1e3',
      inputAmount: 2_000_000n,
      minOutputAmount: 1_000_000_000_000_000_000n, // any value — fillability isn't checked at build time
      deadline: BigInt(Math.floor(Date.now() / 1000) + 600),
      allowPartialFill: false,
      srcAddress, // real address — used for hub-wallet derivation + the intent record
      dstAddress: '0x1468d3529032106291433B7e9e3026dF1Ff78F31',
      data: '0x',
    },
    extras: { srcPublicKey }, // the public key — used to build the unsigned source tx (Stacks-only extra)
    raw: true, // ← returns the unsigned tx, no broadcast (walletProvider is forbidden in raw mode)
  });

  if (!result.ok) {
    console.error('❌ createIntent FAILED:', result.error);
    process.exit(1);
  }

  const { tx, intent, relayData } = result.value;
  console.log('✅ raw tx  :', tx); // { payload: '0x…' }
  console.log('intentId  :', intent.intentId);
  console.log('relayData :', relayData);

  const payload = (tx as { payload?: string }).payload;
  if (typeof payload === 'string' && payload.startsWith('0x') && payload.length > 4) {
    console.log(`✅ PASS — raw data produced (payload ${payload.length} chars)`);
  } else {
    console.error('❌ FAIL — no usable payload in the raw tx');
    process.exit(1);
  }
}

testStacksRawIntent();
