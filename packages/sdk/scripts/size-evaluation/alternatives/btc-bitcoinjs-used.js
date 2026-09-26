import * as ecc from '@bitcoinerlab/secp256k1';
import { initEccLib, networks, Transaction, Psbt, payments, opcodes, script, address } from 'bitcoinjs-lib';
initEccLib(ecc);
export { networks, Transaction, Psbt, payments, opcodes, script, address };
