// src/bitcoin-radfi.ts
import 'dotenv/config';

import * as bitcoin from 'bitcoinjs-lib';
import { ECPairFactory } from 'ecpair';
import * as ecc from '@bitcoinerlab/secp256k1';
import { randomBytes } from 'node:crypto';
import { Signer } from 'bip322-js';

const IS_TESTNET = process.env.IS_TESTNET === 'true';

const network = IS_TESTNET ? bitcoin.networks.testnet : bitcoin.networks.bitcoin;

// Initialize ECPair with the elliptic curve library
const ECPair = ECPairFactory(ecc);

const RADFI_API_BASE_URL = IS_TESTNET
  ? 'https://signet.api.bound.exchange/api'
  : 'https://staging.api.bound.exchange/api';

const RADFI_UMS_BASE_URL = IS_TESTNET
  ? 'https://signet.api.ums.bound.exchange/api'
  : 'https://staging.api.ums.bound.exchange/api';

/**
 * Generate a new Bitcoin private key in HEX format
 * @returns Private key as a 64-character hex string
 */
function generatePrivateKey(): string {
  const privateKeyBytes = randomBytes(32);
  return privateKeyBytes.toString('hex');
}

/**
 * Reads the Bitcoin private key from the environment. Secrets are taken from env vars, not CLI
 * arguments, so they are never exposed to shell history, process listings (`ps`) or CI logs
 * (TOOL-M-1).
 */
function requirePrivateKeyHex(command: string): string {
  const privateKeyHex = process.env.BITCOIN_RADFI_PRIVATE_KEY;
  if (!privateKeyHex) {
    console.error(`Error: set BITCOIN_RADFI_PRIVATE_KEY in the environment for the '${command}' command.`);
    console.error('Secrets are read from the environment (not CLI args) so they are not exposed to');
    console.error('shell history, process listings or CI logs.');
    process.exit(1);
  }
  return privateKeyHex;
}

/** Reads the Radfi/Bound refresh token from the environment (see {@link requirePrivateKeyHex}). */
function requireRefreshToken(): string {
  const refreshTokenValue = process.env.BITCOIN_RADFI_REFRESH_TOKEN;
  if (!refreshTokenValue) {
    console.error("Error: set BITCOIN_RADFI_REFRESH_TOKEN in the environment for the 'refresh-token' command.");
    process.exit(1);
  }
  return refreshTokenValue;
}

/** The shape of a private key pasted where a normal positional argument now belongs. */
const PRIVATE_KEY_HEX = /^[0-9a-fA-F]{64}$/;

/**
 * Guards the commands that used to take the key as `argv[3]`. Those slots now hold ordinary values
 * that get logged and sent to the API, so a key pasted from an old command line would leak again
 * rather than fail. Never echo the offending value — it is already in shell history and `ps`.
 *
 * A bare 64-hex string is not always a key (a txid has the same shape), so the warning is worded
 * conditionally rather than telling every caller to rotate. `ambiguity` names the innocent reading.
 */
function rejectKeyShapedArgs(command: string, positionals: readonly string[], ambiguity?: string): void {
  if (!positionals.some(argument => PRIVATE_KEY_HEX.test(argument))) return;
  console.error(`Error: '${command}' received a bare 64-character hex value as a positional argument.`);
  console.error('The private key is no longer a CLI argument — export BITCOIN_RADFI_PRIVATE_KEY instead.');
  if (ambiguity) console.error(ambiguity);
  console.error('If it was your private key it is now in your shell history and process list —');
  console.error('rotate it before reusing it.');
  process.exit(1);
}

/**
 * Refuses to emit key material anywhere but an interactive terminal. A redirected stdout lands in a
 * file, a pipe or a CI log, where the key outlives the session under nobody's permissions.
 *
 * It cannot catch a pty recorder (`script`, `ssh -t`, tmux, asciinema) — from in here those are
 * indistinguishable from a terminal, so the printed warning has to cover that case instead.
 */
function requireInteractiveStdout(command: string): void {
  if (process.stdout.isTTY) return;
  console.error(`Error: '${command}' prints key material — refusing redirected stdout (file, pipe or CI log).`);
  console.error('Run it in an interactive terminal.');
  process.exit(1);
}

/**
 * Enforces exact arity. Legacy call shapes carried one extra leading argument, so a presence-only
 * check would silently shift every value one slot left instead of failing.
 */
function requireExactArgs(command: string, positionals: readonly string[], expected: number, usage: string[]): void {
  if (positionals.length === expected) return;
  console.error(`Error: '${command}' takes exactly ${expected} argument(s), received ${positionals.length}.`);
  for (const line of usage) console.log(line);
  process.exit(1);
}

/**
 * Create Bitcoin wallet from private key (HEX format)
 * @param privateKeyHex - Private key in HEX format (64 characters)
 * @returns Object containing Bitcoin address and public key (both as hex strings)
 */
function createBitcoinWallet(privateKeyHex: string): { address: string; publicKey: string } {
  // Validate private key format
  if (!/^[0-9a-fA-F]{64}$/.test(privateKeyHex)) {
    throw new Error('Invalid private key format. Expected 64-character hex string.');
  }

  // Convert hex string to Buffer
  const privateKeyBuffer = Buffer.from(privateKeyHex, 'hex');

  // Create key pair from private key
  const keyPair = ECPair.fromPrivateKey(privateKeyBuffer, { network });

  // Get public key
  const publicKey = keyPair.publicKey.toString('hex');

  // Generate P2PKH Bitcoin address (legacy format: starts with 1 for mainnet)
  const { address } = bitcoin.payments.p2pkh({
    pubkey: keyPair.publicKey,
    network,
  });

  if (!address) {
    throw new Error('Failed to generate Bitcoin address');
  }

  return {
    address,
    publicKey,
  };
}

/**
 * Dump all key information and address formats for a private key
 * @param privateKeyHex - Private key in HEX format (64 characters)
 */
function dumpKeyInfo(privateKeyHex: string): void {
  // Validate private key format
  if (!/^[0-9a-fA-F]{64}$/.test(privateKeyHex)) {
    throw new Error('Invalid private key format. Expected 64-character hex string.');
  }

  // Convert hex string to Buffer
  const privateKeyBuffer = Buffer.from(privateKeyHex, 'hex');

  // Create key pair from private key
  const keyPair = ECPair.fromPrivateKey(privateKeyBuffer, { network });

  // Private key formats
  const privateKeyWIF = keyPair.toWIF();
  const privateKeyHexFormatted = privateKeyHex;

  // Public keys
  const publicKeyCompressed = keyPair.publicKey.toString('hex');
  const publicKeyUncompressed = keyPair.publicKey.toString('hex'); // ECPair always uses compressed

  // For Taproot: internal public key (x-coordinate, 32 bytes)
  const internalPubkey = keyPair.publicKey.slice(1, 33);
  const internalPubkeyHex = internalPubkey.toString('hex');

  // Generate all address formats
  const p2pkhAddress = bitcoin.payments.p2pkh({ pubkey: keyPair.publicKey, network }).address;
  const p2wpkhAddress = bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey, network }).address;
  const p2trAddress = bitcoin.payments.p2tr({ internalPubkey, network }).address;

  // Display all information
  console.log('\n=== Bitcoin Key Information Dump ===\n');

  console.log('--- Private Key ---');
  console.log('HEX Format:', privateKeyHexFormatted);
  console.log('WIF Format:', privateKeyWIF);
  console.log('Length:', privateKeyHexFormatted.length, 'characters (hex)');

  console.log('\n--- Public Keys ---');
  console.log('Compressed Public Key (HEX):', publicKeyCompressed);
  console.log('Compressed Public Key Length:', publicKeyCompressed.length, 'characters (66 chars = 33 bytes)');
  console.log('Public Key Prefix:', publicKeyCompressed.slice(0, 2), '(0x02 or 0x03 for compressed)');

  console.log('\n--- Taproot Internal Public Key ---');
  console.log('Internal Pubkey (x-coordinate, 32 bytes):', internalPubkeyHex);
  console.log('Internal Pubkey Length:', internalPubkeyHex.length, 'characters (64 chars = 32 bytes)');

  console.log('\n--- Address Formats ---');
  console.log('P2PKH (Legacy):', p2pkhAddress);
  console.log('P2WPKH (Native SegWit, bc1q...):', p2wpkhAddress);
  console.log('P2TR (Taproot, bc1p...):', p2trAddress);

  console.log('\n--- Network ---');
  console.log('Network:', network === bitcoin.networks.bitcoin ? 'Mainnet' : 'Testnet');
  console.log('Network Magic:', network.messagePrefix);

  console.log('\n=== End of Key Dump ===\n');
}

/**
 * Create trading wallet via Bound Exchange API
 * @param privateKeyHex - Private key in HEX format
 */
async function createTradingWallet(privateKeyHex: string): Promise<void> {
  const { address, publicKey } = createBitcoinWallet(privateKeyHex);

  console.log('Bitcoin Address:', address);
  console.log('Public Key:', publicKey);

  const url = `${RADFI_API_BASE_URL}/wallets`;
  const requestBody = {
    walletAddress: address,
    publicKey,
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP error! Status: ${response.status}, Message: ${errorText}`);
    }

    const result = await response.json();
    console.log('Trading wallet created successfully:', result);
  } catch (error) {
    console.error('Error creating trading wallet:', error instanceof Error ? error.message : String(error));
    throw error;
  }
}

/**
 * Create trading wallet via Bound Exchange API
 * @param privateKeyHex - Private key in HEX format
 */
async function checkTradingWallet(address: string, publicKey: string): Promise<void> {
  console.log('Bitcoin Address:', address);
  console.log('Public Key:', publicKey);

  const url = `${RADFI_API_BASE_URL}/wallets`;
  const requestBody = {
    walletAddress: address,
    publicKey,
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP error! Status: ${response.status}, Message: ${errorText}`);
    }

    const result = await response.json();
    console.log('Trading wallet created successfully:', result);
  } catch (error) {
    console.error('Error creating trading wallet:', error instanceof Error ? error.message : String(error));
    throw error;
  }
}

/**
 * Fetch trading wallet information from Bound Exchange API
 * @param walletAddress - Bitcoin wallet address
 */
async function fetchTradingWallet(walletAddress: string): Promise<void> {
  const url = `${RADFI_API_BASE_URL}/wallets/details/${walletAddress}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP error! Status: ${response.status}, Message: ${errorText}`);
    }

    const result = await response.json();
    console.log('Trading wallet information:', result);
  } catch (error) {
    console.error('Error fetching trading wallet:', error instanceof Error ? error.message : String(error));
    throw error;
  }
}

/**
 * Get trading wallet balance from Bound Exchange API
 * @param walletAddress - Bitcoin wallet address (userAddress)
 */
async function getWalletBalance(walletAddress: string): Promise<void> {
  const url = `${RADFI_API_BASE_URL}/wallets/details/${walletAddress}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP error! Status: ${response.status}, Message: ${errorText}`);
    }

    const result = await response.json();
    const data = (result.data as Record<string, unknown>) || (result as Record<string, unknown>);

    console.log('\n--- Wallet Details ---');
    if (data.tradingAddress) {
      console.log('Trading Address:', data.tradingAddress);
    }
    if (data.userAddress) {
      console.log('User Address:', data.userAddress);
    }
    if (data.userPublicKey) {
      console.log('Public Key:', data.userPublicKey);
    }

    // Display balance information if available
    if (data.balances || (data as { balance?: unknown }).balance) {
      console.log('\n--- Balances ---');
      const balances = data.balances || (data as { balance?: unknown }).balance;
      console.log(JSON.stringify(balances, null, 2));
    }

    // Display full response for debugging
    console.log('\n--- Full Response ---');
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Error fetching wallet balance:', error instanceof Error ? error.message : String(error));
    throw error;
  }
}

/**
 * Create withdraw transaction via Bound Exchange API
 * @param userAddress - User's Bitcoin wallet address
 * @param amount - Amount to withdraw (as string)
 * @param tokenId - Token ID to withdraw (e.g., '2904354:3119' or '0:0' for BTC)
 * @param withdrawTo - Address to withdraw to
 * @param authToken - Optional authentication token
 * @param verbose - Whether to print verbose output (default: true)
 * @returns The base64 PSBT that needs to be signed, or null if not found
 */
async function createWithdrawTransaction(
  userAddress: string,
  amount: string,
  tokenId: string,
  withdrawTo: string,
  authToken?: string,
  verbose = true,
): Promise<string | null> {
  const url = `${RADFI_API_BASE_URL}/transactions`;
  const requestBody = {
    type: 'withdraw',
    params: {
      userAddress,
      amount,
      withdrawTo,
    },
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP error! Status: ${response.status}, Message: ${errorText}`);
    }

    const result = await response.json();
    console.log('Response:', result);

    if (verbose) {
      console.log('Withdraw transaction created:', JSON.stringify(result, null, 2));
    }

    // Extract base64Psbt from response (API returns base64Psbt, not base64Tx)
    const base64Psbt =
      (result.data as { base64Psbt?: string })?.base64Psbt || (result as { base64Psbt?: string })?.base64Psbt || null;

    if (base64Psbt && verbose) {
      console.log('\n--- Transaction to Sign ---');
      console.log('Base64 PSBT:', base64Psbt);
      console.log('Fee:', result.data?.fee);
      console.log('Tx ID:', result.data?.txId);
      console.log('\nTo sign and broadcast, use:');
      console.log(`pnpm run bitcoin-radfi sign-withdraw ${userAddress} <signed_base64_tx>`);
    }

    return base64Psbt;
  } catch (error) {
    console.error('Error creating withdraw transaction:', error instanceof Error ? error.message : String(error));
    throw error;
  }
}

/**
 * Authenticate with Bound Exchange API using BIP322 signature
 * Signs a message with the private key and sends authentication request
 * @param privateKeyHex - Private key in HEX format (64 characters)
 * @returns Authentication response with access and refresh tokens
 */
async function authenticate(privateKeyHex: string): Promise<{
  accessToken: string;
  refreshToken: string;
  tradingAddress: string;
  wallet: unknown;
}> {
  // Validate private key format
  if (!/^[0-9a-fA-F]{64}$/.test(privateKeyHex)) {
    throw new Error('Invalid private key format. Expected 64-character hex string.');
  }

  // Create Bitcoin wallet from private key
  const { address, publicKey } = createBitcoinWallet(privateKeyHex);

  // Generate message (timestamp)
  const message = Date.now().toString();

  console.log('Authenticating with:');
  console.log('Address:', address);
  console.log('Public Key:', publicKey);
  console.log('Message:', message);

  // Sign message with BIP322
  let signature: string;
  try {
    // Convert hex private key to WIF format for bip322-js
    const privateKeyBuffer = Buffer.from(privateKeyHex, 'hex');
    const keyPair = ECPair.fromPrivateKey(privateKeyBuffer, { network });

    // bip322-js expects WIF format private key
    // We need to convert the private key to WIF
    const privateKeyWIF = keyPair.toWIF();

    // Sign the message using BIP322
    signature = Signer.sign(privateKeyWIF, address, message);
    console.log('Signature generated:', signature);
  } catch (error) {
    console.error('Error signing message:', error instanceof Error ? error.message : String(error));
    throw new Error(`Failed to sign message: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Send authentication request
  const url = `${RADFI_API_BASE_URL}/auth/authenticate`;
  const requestBody = {
    message,
    signature,
    address,
    publicKey,
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP error! Status: ${response.status}, Message: ${errorText}`);
    }

    const result = await response.json();

    if (!result.success || !result.data) {
      throw new Error('Authentication failed: Invalid response format');
    }

    const { accessToken, refreshToken, tradingAddress, wallet } = result.data;

    console.log('\n--- Authentication Successful ---');
    console.log('Access Token:', accessToken);
    console.log('Refresh Token:', refreshToken);
    console.log('Trading Address:', tradingAddress);
    console.log('\nWallet Info:', JSON.stringify(wallet, null, 2));
    console.log('\nNote: Access token expires in 10 minutes. Refresh token expires in 7 days.');
    console.log('\nTo use the access token, set it as RADFI_API_KEY environment variable:');
    console.log(`export RADFI_API_KEY="${accessToken}"`);

    return {
      accessToken,
      refreshToken,
      tradingAddress,
      wallet,
    };
  } catch (error) {
    console.error('Error authenticating:', error instanceof Error ? error.message : String(error));
    throw error;
  }
}

/**
 * Refresh access token using refresh token
 * @param refreshTokenValue - Refresh token from previous authentication
 * @returns New access token and wallet info
 */
async function refreshToken(refreshTokenValue: string): Promise<{
  accessToken: string;
  wallet: unknown;
}> {
  const url = `${RADFI_API_BASE_URL}/auth/refresh-token`;
  const requestBody = {
    refreshToken: refreshTokenValue,
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP error! Status: ${response.status}, Message: ${errorText}`);
    }

    const result = await response.json();

    if (!result.success || !result.data) {
      throw new Error('Token refresh failed: Invalid response format');
    }

    const { accessToken, wallet } = result.data;

    console.log('\n--- Token Refresh Successful ---');
    console.log('New Access Token:', accessToken);
    console.log('\nWallet Info:', JSON.stringify(wallet, null, 2));
    console.log('\nTo use the new access token, set it as RADFI_API_KEY environment variable:');
    console.log(`export RADFI_API_KEY="${accessToken}"`);

    return {
      accessToken,
      wallet,
    };
  } catch (error) {
    console.error('Error refreshing token:', error instanceof Error ? error.message : String(error));
    throw error;
  }
}

/**
 * Sign a Bitcoin transaction (PSBT or raw transaction) with private key
 * @param base64Tx - Base64 encoded transaction (PSBT or raw transaction)
 * @param privateKeyHex - Private key in HEX format
 * @returns Signed transaction in base64 format
 */
function signBitcoinTransaction(base64Tx: string, privateKeyHex: string): string {
  // Validate private key format
  if (!/^[0-9a-fA-F]{64}$/.test(privateKeyHex)) {
    throw new Error('Invalid private key format. Expected 64-character hex string.');
  }

  // Convert hex private key to Buffer
  const privateKeyBuffer = Buffer.from(privateKeyHex, 'hex');
  const keyPair = ECPair.fromPrivateKey(privateKeyBuffer, { network });

  try {
    // Try to parse as PSBT first (most common for multisig)
    try {
      const psbt = bitcoin.Psbt.fromBase64(base64Tx);

      // Sign all inputs with the key pair
      psbt.signAllInputs(keyPair);

      // For multisig, we don't finalize yet - just return the signed PSBT
      // The API will handle finalization when all parties have signed
      return psbt.toBase64();
    } catch (psbtError) {
      // If PSBT parsing fails, try as raw transaction
      const txBuffer = Buffer.from(base64Tx, 'base64');
      const tx = bitcoin.Transaction.fromBuffer(txBuffer);

      // Sign all inputs
      for (let i = 0; i < tx.ins.length; i++) {
        const hashType = bitcoin.Transaction.SIGHASH_ALL;
        const hash = tx.hashForSignature(i, tx.ins[i].script, hashType);
        const signature = keyPair.sign(hash);
        const signatureScript = bitcoin.payments.p2pkh({
          pubkey: keyPair.publicKey,
          signature: bitcoin.script.signature.encode(signature, hashType),
        }).input;

        if (signatureScript) {
          tx.ins[i].script = signatureScript;
        }
      }

      // Return as base64
      return tx.toBuffer().toString('base64');
    }
  } catch (error) {
    throw new Error(`Failed to sign transaction: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Sign and broadcast withdraw transaction via Bound Exchange API
 * @param userAddress - User's Bitcoin wallet address
 * @param signedBase64Tx - Base64 encoded signed transaction
 * @param authToken - Optional authentication token
 */
async function signAndBroadcastWithdraw(
  userAddress: string,
  signedBase64Tx: string,
  authToken?: string,
): Promise<void> {
  const url = `${RADFI_API_BASE_URL}/transactions/sign`;
  const requestBody = {
    type: 'withdraw',
    params: {
      userAddress,
      signedBase64Tx,
    },
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP error! Status: ${response.status}, Message: ${errorText}`);
    }

    const result = await response.json();
    console.log('Transaction signed and broadcasted:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(
      'Error signing and broadcasting transaction:',
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  }
}

/**
 * Create, sign, and broadcast withdraw transaction in one call
 * @param privateKeyHex - Private key in HEX format
 * @param amount - Amount to withdraw (as string)
 * @param tokenId - Token ID to withdraw (e.g., '2904354:3119' or '0:0' for BTC)
 * @param withdrawTo - Address to withdraw to
 * @param authToken - Optional authentication token
 */
async function withdrawWithSign(
  privateKeyHex: string,
  amount: string,
  tokenId: string,
  withdrawTo: string,
  authToken?: string,
): Promise<void> {
  // Validate private key format
  if (!/^[0-9a-fA-F]{64}$/.test(privateKeyHex)) {
    throw new Error('Invalid private key format. Expected 64-character hex string.');
  }

  // Get user address from private key
  const { address: userAddress } = createBitcoinWallet(privateKeyHex);

  console.log('Creating withdraw transaction...');
  console.log('User Address:', userAddress);
  console.log('Amount:', amount);
  console.log('Token ID:', tokenId);
  console.log('Withdraw To:', withdrawTo);

  // Step 1: Create the transaction (suppress verbose output)
  const base64Psbt = await createWithdrawTransaction(userAddress, amount, tokenId, withdrawTo, authToken, false);

  if (!base64Psbt) {
    throw new Error('Failed to get transaction from API. No base64Psbt in response.');
  }

  console.log('\n--- Signing Transaction ---');

  // Step 2: Sign the transaction (PSBT)
  let signedBase64Tx: string;
  try {
    signedBase64Tx = signBitcoinTransaction(base64Psbt, privateKeyHex);
    console.log('Transaction signed successfully');
  } catch (error) {
    console.error('Error signing transaction:', error instanceof Error ? error.message : String(error));
    throw error;
  }

  console.log('\n--- Broadcasting Transaction ---');

  // Step 3: Sign and broadcast
  await signAndBroadcastWithdraw(userAddress, signedBase64Tx, authToken);
}

/**
 * Fetch expired UTXOs for a trading wallet address
 * @param tradingAddress - Trading wallet address
 * @returns Array of expired UTXOs
 */
async function getExpiredUtxos(tradingAddress: string): Promise<{ txId: string; vout: number; value: string }[]> {
  const url = `${RADFI_UMS_BASE_URL}/utxos?address_eq=${tradingAddress}&isSpent_eq=false&isExpired_eq=true&page=1&pageSize=100`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP error! Status: ${response.status}, Message: ${errorText}`);
    }

    const result = await response.json();
    const utxos = result.data || [];

    console.log(`\n--- Expired UTXOs for ${tradingAddress} ---`);
    console.log(`Network: ${IS_TESTNET ? 'SIGNET (testnet)' : 'MAINNET (staging)'}`);
    console.log(`UMS URL: ${RADFI_UMS_BASE_URL}`);
    console.log(`Total: ${utxos.length}`);

    if (utxos.length === 0) {
      console.log('No expired UTXOs found.');
    } else {
      for (const utxo of utxos) {
        console.log(
          `  ${utxo.txId}:${utxo.vout} — ${utxo.value} sats (expired: ${utxo.isExpired}, expiryBlock: ${utxo.expiryBlock || 'N/A'})`,
        );
      }
      console.log('\nTo renew, run:');
      const txIdVouts = utxos.map((u: { txId: string; vout: number }) => `${u.txId}:${u.vout}`).join(',');
      console.log(`  BITCOIN_RADFI_PRIVATE_KEY=… pnpm run bitcoin-radfi renew ${txIdVouts}`);
    }

    return utxos;
  } catch (error) {
    console.error('Error fetching expired UTXOs:', error instanceof Error ? error.message : String(error));
    throw error;
  }
}

/**
 * Renew expired UTXOs: auth → build → sign → co-sign & broadcast
 * @param privateKeyHex - Private key in HEX format
 * @param txIdVoutsStr - Comma-separated txId:vout pairs (e.g. "abc:0,def:1")
 */
async function renewUtxos(privateKeyHex: string, txIdVoutsStr: string): Promise<void> {
  const txIdVouts = txIdVoutsStr.split(',').map(s => s.trim());
  console.log(`\n--- Renewing ${txIdVouts.length} UTXO(s) ---`);
  console.log(`Network: ${IS_TESTNET ? 'SIGNET (testnet)' : 'MAINNET (staging)'}`);
  console.log('UTXOs:', txIdVouts);

  // Step 1: Authenticate
  console.log('\n[1/4] Authenticating...');
  const { accessToken } = await authenticate(privateKeyHex);
  const { address: userAddress } = createBitcoinWallet(privateKeyHex);

  // Step 2: Build renew-utxo transaction
  console.log('\n[2/4] Building renew-utxo transaction...');
  const buildUrl = `${RADFI_API_BASE_URL}/transactions`;
  const buildResponse = await fetch(buildUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      type: 'renew-utxo',
      params: { userAddress, txIdVouts },
    }),
  });

  if (!buildResponse.ok) {
    const errText = await buildResponse.text();
    throw new Error(`Failed to build renew transaction: ${errText}`);
  }

  const buildResult = await buildResponse.json();
  const { base64Psbt, fee, txId: provisionalTxId } = buildResult.data;
  console.log('Unsigned PSBT received');
  console.log('Fee:', fee, 'sats');
  console.log('Provisional TxId:', provisionalTxId);

  // Step 3: Sign PSBT
  console.log('\n[3/4] Signing PSBT...');
  const signedBase64Tx = signBitcoinTransaction(base64Psbt, privateKeyHex);
  console.log('PSBT signed successfully');

  // Step 4: Submit for co-signing and broadcast
  console.log('\n[4/4] Submitting for co-sign & broadcast...');
  const signUrl = `${RADFI_API_BASE_URL}/transactions/sign`;
  const signResponse = await fetch(signUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      type: 'renew-utxo',
      params: { userAddress, signedBase64Tx },
    }),
  });

  if (!signResponse.ok) {
    const errText = await signResponse.text();
    throw new Error(`Failed to co-sign & broadcast: ${errText}`);
  }

  const signResult = await signResponse.json();
  const finalTxId = signResult.data?.txId || signResult.data;

  console.log('\n--- Renewal Complete ---');
  console.log('Transaction ID:', finalTxId);
  const explorerBase = IS_TESTNET ? 'https://mempool.space/signet' : 'https://mempool.space';
  console.log(`Explorer: ${explorerBase}/tx/${finalTxId}`);
}

/**
 * Main function with command-line argument parsing
 */
async function main(): Promise<void> {
  const command = process.argv[2];
  const positionals = process.argv.slice(3);

  if (command === 'generate') {
    // The key exists only in memory, so stdout is its single delivery channel — printing it is the
    // whole point of the command, unlike `dump`, where the key already lives elsewhere. Both checks
    // run before the wallet exists: a run that cannot disclose the key must not leave behind a
    // spendable-looking address nobody holds the key for.
    if (process.env.SHOW_PRIVATE_KEY !== 'true') {
      console.error('Error: `generate` produces a private key that is stored nowhere else.');
      console.error('Set SHOW_PRIVATE_KEY=true to have it printed, then move it into a secret manager.');
      process.exit(1);
    }
    requireInteractiveStdout('generate');

    const privateKey = generatePrivateKey();
    const { address, publicKey } = createBitcoinWallet(privateKey);

    console.log('Generated Bitcoin Wallet:');
    console.log('Private Key (HEX):', privateKey);
    console.log('Public Key (HEX):', publicKey);
    console.log('Bitcoin Address:', address);
    console.warn('\nWARNING: the private key was printed to this terminal. Avoid shared shells, and note');
    console.warn('that a pty recorder (script, ssh -t, tmux, asciinema) captures it despite the TTY check.');
    console.log('Store it in a secret manager now and export it as BITCOIN_RADFI_PRIVATE_KEY for the other');
    console.log('commands — this script writes it nowhere, so it is unrecoverable once the process exits.');
  } else if (command === 'dump') {
    rejectKeyShapedArgs('dump', positionals);
    requireExactArgs('dump', positionals, 0, ['Usage: BITCOIN_RADFI_PRIVATE_KEY=… pnpm run bitcoin-radfi dump']);
    // `dump` prints the key in HEX and WIF — the same disclosure `generate` makes, so it gets the
    // same stdout guard. No opt-in flag: naming the command is already the explicit intent.
    requireInteractiveStdout('dump');
    dumpKeyInfo(requirePrivateKeyHex('dump'));
  } else if (command === 'create') {
    rejectKeyShapedArgs('create', positionals);
    requireExactArgs('create', positionals, 0, ['Usage: BITCOIN_RADFI_PRIVATE_KEY=… pnpm run bitcoin-radfi create']);
    await createTradingWallet(requirePrivateKeyHex('create'));
  } else if (command === 'check') {
    const address = process.argv[3];
    const publicKey = process.argv[4];
    if (!address || !publicKey) {
      console.error('Error: Address and public key are required for check command');
      console.log('Usage: pnpm run bitcoin-radfi check <address> <public_key>');
      process.exit(1);
    }
    await checkTradingWallet(address, publicKey);
  } else if (command === 'fetch') {
    const walletAddress = process.argv[3];
    if (!walletAddress) {
      console.error('Error: Wallet address is required for fetch command');
      console.log('Usage: pnpm run bitcoin-radfi fetch <wallet_address>');
      process.exit(1);
    }
    await fetchTradingWallet(walletAddress);
  } else if (command === 'balance') {
    const walletAddress = process.argv[3];
    if (!walletAddress) {
      console.error('Error: Wallet address is required for balance command');
      console.log('Usage: pnpm run bitcoin-radfi balance <wallet_address>');
      process.exit(1);
    }
    await getWalletBalance(walletAddress);
  } else if (command === 'withdraw') {
    rejectKeyShapedArgs('withdraw', positionals);
    requireExactArgs('withdraw', positionals, 3, [
      'Usage: BITCOIN_RADFI_PRIVATE_KEY=… pnpm run bitcoin-radfi withdraw <amount> <token_id> <withdraw_to>',
      'Example: BITCOIN_RADFI_PRIVATE_KEY=… pnpm run bitcoin-radfi withdraw 10000 0:0 tb1q...',
    ]);
    const [amount, tokenId, withdrawTo] = positionals;

    // Validate before anything is logged or sent: `withdrawWithSign` echoes these and forwards them
    // to the transactions API.
    if (!/^\d+$/.test(amount)) {
      console.error('Error: <amount> must be a whole number of sats.');
      process.exit(1);
    }
    if (!/^\d+:\d+$/.test(tokenId)) {
      console.error("Error: <token_id> must look like '2904354:3119' (or '0:0' for BTC).");
      process.exit(1);
    }
    try {
      // Also catches a mistyped destination before anything is signed and broadcast.
      bitcoin.address.toOutputScript(withdrawTo, network);
    } catch {
      console.error(`Error: <withdraw_to> is not a valid ${IS_TESTNET ? 'signet/testnet' : 'mainnet'} address.`);
      process.exit(1);
    }

    const privateKeyHex = requirePrivateKeyHex('withdraw');
    const authToken = process.env.RADFI_API_KEY;
    await withdrawWithSign(privateKeyHex, amount, tokenId, withdrawTo, authToken);
  } else if (command === 'sign-withdraw') {
    const userAddress = process.argv[3];
    const signedBase64Tx = process.argv[4];
    const authToken = process.env.RADFI_API_KEY;

    if (!userAddress || !signedBase64Tx) {
      console.error('Error: Missing required parameters for sign-withdraw command');
      console.log('Usage: pnpm run bitcoin-radfi sign-withdraw <user_address> <signed_base64_tx>');
      process.exit(1);
    }
    await signAndBroadcastWithdraw(userAddress, signedBase64Tx, authToken);
  } else if (command === 'auth') {
    rejectKeyShapedArgs('auth', positionals);
    requireExactArgs('auth', positionals, 0, ['Usage: BITCOIN_RADFI_PRIVATE_KEY=… pnpm run bitcoin-radfi auth']);
    await authenticate(requirePrivateKeyHex('auth'));
  } else if (command === 'refresh-token') {
    requireExactArgs('refresh-token', positionals, 0, [
      'Usage: BITCOIN_RADFI_REFRESH_TOKEN=… pnpm run bitcoin-radfi refresh-token',
    ]);
    await refreshToken(requireRefreshToken());
  } else if (command === 'expired') {
    const tradingAddress = process.argv[3];
    if (!tradingAddress) {
      console.error('Error: Trading address is required for expired command');
      console.log('Usage: pnpm run bitcoin-radfi expired <trading_address>');
      process.exit(1);
    }
    await getExpiredUtxos(tradingAddress);
  } else if (command === 'renew') {
    rejectKeyShapedArgs(
      'renew',
      positionals,
      'A txid is 64 hex characters too — it needs its vout suffix, e.g. <txid>:0.',
    );
    requireExactArgs('renew', positionals, 1, [
      'Usage: BITCOIN_RADFI_PRIVATE_KEY=… pnpm run bitcoin-radfi renew <txId:vout,txId:vout,...>',
      'Example: BITCOIN_RADFI_PRIVATE_KEY=… pnpm run bitcoin-radfi renew txid1:0,txid2:1',
      '\nTip: Run "pnpm run bitcoin-radfi expired <trading_address>" first to find expired UTXOs',
    ]);
    const txIdVoutsStr = positionals[0];

    // Validate before anything is logged or sent: `renewUtxos` echoes these and puts them in the
    // transactions API request body.
    const invalid = txIdVoutsStr.split(',').filter(pair => !/^[0-9a-fA-F]{64}:\d+$/.test(pair.trim()));
    if (invalid.length > 0) {
      console.error(`Error: ${invalid.length} malformed txId:vout pair(s) — expected <64-hex txid>:<vout>.`);
      process.exit(1);
    }

    const privateKeyHex = requirePrivateKeyHex('renew');
    await renewUtxos(privateKeyHex, txIdVoutsStr);
  } else {
    console.log(`Usage: (network: ${IS_TESTNET ? 'SIGNET' : 'MAINNET staging'})`);
    console.log('  Environment (secrets never come from CLI args — avoids shell history / ps / CI-log leaks):');
    console.log('    BITCOIN_RADFI_PRIVATE_KEY   - private key (HEX) for dump/create/withdraw/auth/renew');
    console.log('    BITCOIN_RADFI_REFRESH_TOKEN - refresh token for refresh-token');
    console.log('    SHOW_PRIVATE_KEY=true       - required by `generate`; its key is stored nowhere else');
    console.log('  `generate` and `dump` print key material and refuse a redirected stdout — run them in a TTY.');
    console.log('');
    console.log('  pnpm run bitcoin-radfi generate                   - Generate a new Bitcoin private key and wallet');
    console.log('  pnpm run bitcoin-radfi dump                       - Dump key + address formats (TTY only)');
    console.log('  pnpm run bitcoin-radfi create                     - Create a trading wallet using private key');
    console.log('  pnpm run bitcoin-radfi fetch <wallet_address>     - Fetch trading wallet information');
    console.log('  pnpm run bitcoin-radfi balance <wallet_address>   - Get trading wallet balance');
    console.log(
      '  pnpm run bitcoin-radfi withdraw <amount> <token_id> <withdraw_to> - Create, sign and broadcast withdraw transaction',
    );
    console.log(
      '  pnpm run bitcoin-radfi sign-withdraw <user_address> <signed_base64_tx> - Sign and broadcast withdraw transaction',
    );
    console.log(
      '  pnpm run bitcoin-radfi auth                       - Authenticate with BIP322 signature (signs automatically)',
    );
    console.log('  pnpm run bitcoin-radfi refresh-token              - Refresh access token');
    console.log('  pnpm run bitcoin-radfi expired <trading_address>  - List expired UTXOs');
    console.log('  pnpm run bitcoin-radfi renew <txId:vout,...>      - Renew expired UTXOs');
    console.log('\nSet IS_TESTNET=true to use signet (testnet) instead of mainnet staging.');
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
