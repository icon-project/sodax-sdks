// Equivalent surface over Cosmos/CosmWasm REST (LCD) + cosmjs-types protobuf encoders:
// wasm smart query, bank balances, account (number/sequence), simulate + broadcast of MsgExecuteContract.
import { TxRaw, TxBody, AuthInfo, SignerInfo, Fee, SignDoc } from 'cosmjs-types/cosmos/tx/v1beta1/tx.js';
import { MsgExecuteContract } from 'cosmjs-types/cosmwasm/wasm/v1/tx.js';
import { SignMode } from 'cosmjs-types/cosmos/tx/signing/v1beta1/signing.js';
import { Any } from 'cosmjs-types/google/protobuf/any.js';
const b64 = u8 => btoa(String.fromCharCode(...u8));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const get = async (base, path) => {
  const r = await fetch(`${base}${path}`);
  if (!r.ok) throw new Error(`${r.status} ${path}`);
  return r.json();
};
export const querySmart = (lcd, contract, msg) =>
  get(lcd, `/cosmwasm/wasm/v1/contract/${contract}/smart/${b64(new TextEncoder().encode(JSON.stringify(msg)))}`).then(
    r => r.data,
  );
export const balances = (lcd, addr) => get(lcd, `/cosmos/bank/v1beta1/balances/${addr}`).then(r => r.balances);
export const account = (lcd, addr) =>
  get(lcd, `/cosmos/auth/v1beta1/accounts/${addr}`).then(r => r.account.base_account ?? r.account);
// Injective EthSecp256k1 pubkey: one protobuf bytes field (tag 0x0a), wrapped in Any.
const injPubKey = key =>
  Any.fromPartial({
    typeUrl: '/injective.crypto.v1beta1.ethsecp256k1.PubKey',
    value: Uint8Array.from([0x0a, key.length, ...key]),
  });
export function buildTx({ sender, contract, msg, funds, pubKey, sequence, accountNumber, chainId, gas, feeAmount }) {
  const exec = MsgExecuteContract.fromPartial({
    sender,
    contract,
    msg: new TextEncoder().encode(JSON.stringify(msg)),
    funds,
  });
  const body = TxBody.fromPartial({
    messages: [{ typeUrl: '/cosmwasm.wasm.v1.MsgExecuteContract', value: MsgExecuteContract.encode(exec).finish() }],
  });
  const authInfo = AuthInfo.fromPartial({
    signerInfos: [
      SignerInfo.fromPartial({
        publicKey: injPubKey(pubKey),
        modeInfo: { single: { mode: SignMode.SIGN_MODE_DIRECT } },
        sequence: BigInt(sequence),
      }),
    ],
    fee: Fee.fromPartial({ amount: feeAmount, gasLimit: BigInt(gas) }),
  });
  const bodyBytes = TxBody.encode(body).finish();
  const authInfoBytes = AuthInfo.encode(authInfo).finish();
  const signDoc = SignDoc.encode(
    SignDoc.fromPartial({ bodyBytes, authInfoBytes, chainId, accountNumber: BigInt(accountNumber) }),
  ).finish();
  return {
    bodyBytes,
    authInfoBytes,
    signDoc,
    raw: sig => TxRaw.encode(TxRaw.fromPartial({ bodyBytes, authInfoBytes, signatures: [sig] })).finish(),
  };
}
const post = async (base, path, body) =>
  (
    await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  ).json();
export const simulate = (lcd, txBytes) => post(lcd, '/cosmos/tx/v1beta1/simulate', { tx_bytes: b64(txBytes) });
export const broadcast = (lcd, txBytes) =>
  post(lcd, '/cosmos/tx/v1beta1/txs', { tx_bytes: b64(txBytes), mode: 'BROADCAST_MODE_SYNC' });
export { unb64 };
