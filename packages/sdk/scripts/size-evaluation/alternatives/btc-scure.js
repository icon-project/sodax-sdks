// Equivalent of BitcoinSpokeService/btc-utils lib surface on @scure/btc-signer (PSBT build/parse, payments, address codec).
import { Transaction, p2wpkh, p2tr, p2sh, OutScript, Address, NETWORK, Script } from '@scure/btc-signer';
import { base64, hex } from '@scure/base';
export function buildPsbt({ pubkey, utxos, to, amount, change, memo }) {
  const pay = p2wpkh(pubkey, NETWORK);
  const tx = new Transaction({ allowUnknownOutputs: true });
  for (const u of utxos)
    tx.addInput({ txid: u.txid, index: u.vout, witnessUtxo: { script: pay.script, amount: BigInt(u.value) } });
  tx.addOutputAddress(to, amount, NETWORK);
  tx.addOutput({ script: Script.encode(['RETURN', memo]), amount: 0n });
  tx.addOutputAddress(change, 1000n, NETWORK);
  return base64.encode(tx.toPSBT());
}
export const parsePsbt = b64 => Transaction.fromPSBT(base64.decode(b64));
export const decodeAddress = a => OutScript.encode(Address(NETWORK).decode(a));
export const isValid = a => {
  try {
    Address(NETWORK).decode(a);
    return true;
  } catch {
    return false;
  }
};
export const taproot = pk => p2tr(pk, undefined, NETWORK).address;
export const nested = pk => p2sh(p2wpkh(pk, NETWORK), NETWORK).address;
export const toHex = b => hex.encode(b);
