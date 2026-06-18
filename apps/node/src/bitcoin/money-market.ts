import 'dotenv/config';
import { ChainKeys, Sodax, spokeChainConfig } from '@sodax/sdk';
import type { BtcAddressType, Hex } from '@sodax/types';
import { BitcoinWalletProvider } from '@sodax/wallet-sdk-core';

/**
 * E2E: Bitcoin money-market borrow / withdraw via the Bound Exchange trading wallet (on-demand relay).
 *
 * Bitcoin borrow/withdraw do NOT broadcast a spoke transaction — the SDK signs an on-demand payload
 * and the relay tracks the resulting packet under a derived poll id (`od:<keccak256(payload_hex)>`).
 * That poll id is what `borrow()` / `withdraw()` return as `srcChainTxHash` and what SodaxScan
 * resolves (there is no Bitcoin chain tx to link).
 *
 * Prerequisites (this script does NOT set them up):
 *   - BTC_PRIVATE_KEY        hex private key of the PERSONAL Bitcoin wallet. Its Bound Exchange trading wallet
 *                            must already exist (sign in once on the dapp) and hold MM collateral.
 *   - BASE_RECIPIENT_ADDRESS EVM address on Base that receives the borrowed SODA.
 *   - BTC_ADDRESS_TYPE       optional: P2TR | P2WPKH | P2SH | P2PKH (default P2TR). Must match your
 *                            key — it selects the message-signing scheme (BIP322 vs ECDSA).
 *
 * Run:  ACTION=borrow   tsx apps/node/src/bitcoin/money-market.ts
 *       ACTION=withdraw tsx apps/node/src/bitcoin/money-market.ts
 */

const btcPrivateKey = process.env.BTC_PRIVATE_KEY;
const baseRecipient = process.env.BASE_RECIPIENT_ADDRESS;
const addressType = (process.env.BTC_ADDRESS_TYPE ?? 'P2TR') as BtcAddressType;
const action = (process.env.ACTION ?? 'borrow') as 'borrow' | 'withdraw';

if (!btcPrivateKey) {
  throw new Error('BTC_PRIVATE_KEY environment variable is required');
}
if (!baseRecipient) {
  throw new Error('BASE_RECIPIENT_ADDRESS environment variable is required');
}

// Default config targets mainnet (production defaults from @sodax/types) — enough for a relay E2E.
const sodax = new Sodax();

// Personal signer. Bound Exchange derives the trading wallet from its public key; `addressType` selects the
// message-signing scheme used for the on-demand payload (P2TR/P2WPKH → BIP322, P2SH/P2PKH → ECDSA).
const walletProvider = new BitcoinWalletProvider({
  type: 'PRIVATE_KEY',
  privateKey: btcPrivateKey as Hex,
  network: 'MAINNET',
  addressType,
});

const sodaOnBase = spokeChainConfig[ChainKeys.BASE_MAINNET].supportedTokens.SODA; // borrow asset
const btcCollateral = spokeChainConfig[ChainKeys.BITCOIN_MAINNET].supportedTokens.BTC; // collateral asset

function logResult(label: string, value: { srcChainTxHash: string; dstChainTxHash: string }): void {
  // Bitcoin on-demand: srcChainTxHash is the relay poll id (od:<hash>), not a chain tx hash.
  console.log(`[btc-mm] ${label} ok`);
  console.log('  poll id (srcChainTxHash):', value.srcChainTxHash);
  console.log('  dst tx hash:', value.dstChainTxHash);
  console.log('  SodaxScan:', `https://sodaxscan.com/api/search?value=${encodeURIComponent(value.srcChainTxHash)}`);
}

async function main(): Promise<void> {
  const srcAddress = await walletProvider.getWalletAddress();
  console.log(`[btc-mm] action=${action} personal=${srcAddress} (${addressType})`);

  // Borrow/withdraw resolve the trading wallet from the personal address, so it must already exist.
  const radfi = sodax.spoke.bitcoin.radfi;
  if (!(await radfi.checkIfTradingWalletExists(srcAddress))) {
    throw new Error(
      `No Bound Exchange trading wallet for ${srcAddress}. Sign in once on the dapp to create it and supply collateral first.`,
    );
  }
  const { tradingAddress } = await radfi.getTradingWallet(srcAddress);
  console.log('[btc-mm] trading wallet:', tradingAddress);

  if (action === 'borrow') {
    // Borrow SODA against the trading wallet's collateral, delivered cross-chain to Base.
    const amount = 10n ** BigInt(sodaOnBase.decimals); // 1 SODA (18 decimals)
    console.log(`[btc-mm] borrowing 1 ${sodaOnBase.symbol} -> Base ${baseRecipient}`);
    const result = await sodax.moneyMarket.borrow({
      raw: false,
      params: {
        srcChainKey: ChainKeys.BITCOIN_MAINNET,
        srcAddress,
        token: sodaOnBase.address,
        amount,
        action: 'borrow',
        dstChainKey: ChainKeys.BASE_MAINNET,
        dstAddress: baseRecipient,
      },
      walletProvider,
    });
    if (!result.ok) {
      throw new Error(`borrow failed: ${result.error.code} - ${result.error.message}`);
    }
    logResult('borrow', result.value);
    return;
  }

  // Withdraw BTC collateral back to the trading wallet. Bitcoin destinations always route to the
  // trading wallet (never the personal address). 1000 sats = 0.00001 BTC; keep it <= your collateral.
  const amount = 1_000n; // sats (BTC has 8 decimals)
  console.log(`[btc-mm] withdrawing ${amount} sats ${btcCollateral.symbol} -> trading wallet ${tradingAddress}`);
  const result = await sodax.moneyMarket.withdraw({
    raw: false,
    params: {
      srcChainKey: ChainKeys.BITCOIN_MAINNET,
      srcAddress,
      token: btcCollateral.address,
      amount,
      action: 'withdraw',
      dstChainKey: ChainKeys.BITCOIN_MAINNET,
      dstAddress: tradingAddress,
    },
    walletProvider,
  });
  if (!result.ok) {
    throw new Error(`withdraw failed: ${result.error.code} - ${result.error.message}`);
  }
  logResult('withdraw', result.value);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
