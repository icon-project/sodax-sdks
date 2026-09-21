import { XService } from '@/core/XService.js';
import { isNativeToken } from '@/utils/index.js';
import type { XToken } from '@sodax/types';
import { type Connection, PublicKey } from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  unpackAccount,
} from '@solana/spl-token';
import type { WalletContextState } from '@solana/wallet-adapter-react';

export class SolanaXService extends XService {
  private static instance: SolanaXService;

  public connection: Connection | undefined;
  public wallet: WalletContextState | undefined;

  private constructor() {
    super('SOLANA');
  }

  public static getInstance(): SolanaXService {
    if (!SolanaXService.instance) {
      SolanaXService.instance = new SolanaXService();
    }
    return SolanaXService.instance;
  }

  override async getBalance(address: string | undefined, xToken: XToken): Promise<bigint> {
    if (!address) return BigInt(0);

    const connection = this.connection;
    if (!connection) {
      return BigInt(0);
    }

    try {
      if (isNativeToken(xToken)) {
        const newBalance = await connection.getBalance(new PublicKey(address));
        return BigInt(newBalance);
      }

      const owner = new PublicKey(address);
      const mint = new PublicKey(xToken.address);

      // The mint belongs to either the legacy SPL Token program or Token-2022 (e.g. xStock
      // tokens like CRCLx), and the two derive different ATAs. Read the candidate ATA for each
      // in one getMultipleAccounts call (a fast, direct keyed lookup) and use the one that exists.
      const candidates = [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].map(programId => ({
        programId,
        ata: getAssociatedTokenAddressSync(mint, owner, true, programId),
      }));

      const accounts = await connection.getMultipleAccountsInfo(candidates.map(c => c.ata));

      // A mint is owned by exactly one program, so normally only one ATA exists. Summing (and
      // skipping anything that isn't a token account for that program) keeps the result correct
      // even if a stray account sits at the other candidate address.
      let balance = BigInt(0);
      for (const [i, candidate] of candidates.entries()) {
        const info = accounts[i];
        if (!info) continue;
        try {
          balance += unpackAccount(candidate.ata, info, candidate.programId).amount;
        } catch {
          // Not a token account for this program — ignore it.
        }
      }
      return balance;
    } catch {
      return BigInt(0);
    }
  }
}
