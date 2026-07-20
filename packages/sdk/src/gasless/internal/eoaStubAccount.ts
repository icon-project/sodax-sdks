import type { Address, PrivateKeyAccount } from 'viem';

/** View-only owner for `toSimple7702SmartAccount` during keyless `prepare`: viem only reads `owner.address` + the constant stub signature for gas estimation and never signs (real signing is out-of-band in `submit`), so signing throws here. The `as unknown as PrivateKeyAccount` cast bridges viem's key-bearing type to this keyless runtime, where that shape genuinely cannot exist. */
export function viewOnlyOwner(address: Address): PrivateKeyAccount {
  const cannotSign = (): never => {
    throw new Error('gasless: view-only owner cannot sign during keyless prepare');
  };
  return {
    address,
    type: 'local',
    source: 'privateKey',
    publicKey: '0x',
    sign: cannotSign,
    signMessage: cannotSign,
    signTransaction: cannotSign,
    signTypedData: cannotSign,
    signAuthorization: cannotSign,
    nonceManager: undefined,
  } as unknown as PrivateKeyAccount;
}
