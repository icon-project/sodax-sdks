// Equivalent of SolanaSpokeService's lib surface on @solana/kit + program clients, with the two
// Anchor programs replaced by static (Codama-style) instruction encoders instead of runtime IDL.
import {
  createSolanaRpc,
  address,
  getAddressEncoder,
  getProgramDerivedAddress,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  compileTransaction,
  getBase64EncodedWireTransaction,
  getStructEncoder,
  getU64Encoder,
  getBytesEncoder,
  addEncoderSizePrefix,
  getU32Encoder,
  fixEncoderSize,
  AccountRole,
  getBase58Decoder,
  transformEncoder,
} from '@solana/kit';
import { getSetComputeUnitLimitInstruction, getSetComputeUnitPriceInstruction } from '@solana-program/compute-budget';
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS, getTokenDecoder } from '@solana-program/token';
import { SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system';

const bytes = addEncoderSizePrefix(getBytesEncoder(), getU32Encoder());
const depositArgs = transformEncoder(
  getStructEncoder([
    ['discriminator', fixEncoderSize(getBytesEncoder(), 8)],
    ['amount', getU64Encoder()],
    ['to', bytes],
    ['data', bytes],
  ]),
  v => ({ ...v, discriminator: new Uint8Array([242, 35, 198, 137, 82, 225, 242, 182]) }),
);
export async function buildDeposit({
  rpcUrl,
  wallet,
  programId,
  mint,
  amount,
  to,
  data,
  tokenProgram = TOKEN_PROGRAM_ADDRESS,
}) {
  const rpc = createSolanaRpc(rpcUrl);
  const program = address(programId);
  const enc = getAddressEncoder();
  const [config] = await getProgramDerivedAddress({ programAddress: program, seeds: ['config'] });
  const [vault] = await getProgramDerivedAddress({
    programAddress: program,
    seeds: ['vault', enc.encode(address(mint))],
  });
  const [ata] = await findAssociatedTokenPda({ owner: address(wallet), mint: address(mint), tokenProgram });
  const acc = await rpc.getMultipleAccounts([ata], { encoding: 'base64' }).send();
  const decoded = acc.value[0] ? getTokenDecoder().decode(Buffer.from(acc.value[0].data[0], 'base64')) : null;
  const { value: bh } = await rpc.getLatestBlockhash().send();
  const ix = {
    programAddress: program,
    accounts: [
      { address: address(wallet), role: AccountRole.WRITABLE_SIGNER },
      { address: config, role: AccountRole.READONLY },
      { address: vault, role: AccountRole.WRITABLE },
      { address: ata, role: AccountRole.WRITABLE },
      { address: tokenProgram, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
    ],
    data: depositArgs.encode({ amount, to, data }),
  };
  const msg = pipe(
    createTransactionMessage({ version: 0 }),
    m => setTransactionMessageFeePayer(address(wallet), m),
    m => setTransactionMessageLifetimeUsingBlockhash(bh, m),
    m =>
      appendTransactionMessageInstructions(
        [
          getSetComputeUnitLimitInstruction({ units: 400000 }),
          getSetComputeUnitPriceInstruction({ microLamports: 1000n }),
          ix,
        ],
        m,
      ),
  );
  const wire = getBase64EncodedWireTransaction(compileTransaction(msg));
  const sim = await rpc.simulateTransaction(wire, { encoding: 'base64' }).send();
  return { wire, sim, decoded, sig: getBase58Decoder().decode(new Uint8Array(64)) };
}
