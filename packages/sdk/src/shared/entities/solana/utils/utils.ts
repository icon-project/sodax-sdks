import { PublicKey, type TransactionInstruction, Connection } from '@solana/web3.js';
import type { Hex } from 'viem';
import { ChainKeys, spokeChainConfig, type SolanaRawTransactionInstruction } from '@sodax/types';
import { AnchorProvider, Program } from '@coral-xyz/anchor';
import type { AssetManager } from '../types/asset_manager.js';
import type { Connection as ConnectionContract } from '../types/connection.js';
export async function getProvider(base58PublicKey: string, rpcUrl: string): Promise<AnchorProvider> {
  const wallet = {
    publicKey: new PublicKey(base58PublicKey),
    signTransaction: () => Promise.reject(),
    signAllTransactions: () => Promise.reject(),
  };
  const connection = new Connection(rpcUrl);
  return new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
}

export async function getAssetManagerIdl(assetManager: string, provider: AnchorProvider) {
  try {
    const idl = await Program.fetchIdl(new PublicKey(assetManager), provider);

    if (!idl) {
      throw new Error('asset manager idl not available');
    }

    return idl;
  } catch (err) {
    console.error('Failed to fetch Program IDl:', err);
    throw err;
  }
}

export async function getConnectionIdl(connection: string, provider: AnchorProvider) {
  try {
    const idl = await Program.fetchIdl(new PublicKey(connection), provider);

    if (!idl) {
      throw new Error('asset manager idl not available');
    }

    return idl;
  } catch (err) {
    console.log('Failed to fetch Program IDl:', err);
    throw err;
  }
}

export async function getAssetManagerProgram(
  base58PublicKey: string,
  rpcUrl: string,
  assetManager: string,
): Promise<Program<AssetManager>> {
  const provider = await getProvider(base58PublicKey, rpcUrl);
  const idl = await getAssetManagerIdl(assetManager, provider);

  return new Program(idl, provider) as unknown as Program<AssetManager>;
}

export async function getConnectionProgram(
  base58PublicKey: string,
  rpcUrl: string,
  connection: string,
): Promise<Program<ConnectionContract>> {
  const provider = await getProvider(base58PublicKey, rpcUrl);
  const idl = await getConnectionIdl(connection, provider);

  return new Program(idl, provider) as unknown as Program<ConnectionContract>;
}

export function getSolanaAddressBytes(address: PublicKey): Hex {
  return `0x${Buffer.from(address.toBytes()).toString('hex')}` as Hex;
}

export function hexToSolanaAddress(hex: Hex): PublicKey {
  const hexWithoutPrefix = hex.startsWith('0x') ? hex.slice(2) : hex;
  return new PublicKey(Buffer.from(hexWithoutPrefix, 'hex'));
}

export function isSolanaNativeToken(address: PublicKey): boolean {
  if (address.equals(new PublicKey(spokeChainConfig[ChainKeys.SOLANA_MAINNET].nativeToken))) {
    return true;
  }
  return false;
}

export function convertTransactionInstructionToRaw(
  instruction: TransactionInstruction,
): SolanaRawTransactionInstruction {
  return {
    keys: instruction.keys.map(key => ({
      pubkey: key.pubkey.toBase58(),
      isSigner: key.isSigner,
      isWritable: key.isWritable,
    })),
    programId: instruction.programId.toBase58(),
    data: instruction.data,
  };
}
