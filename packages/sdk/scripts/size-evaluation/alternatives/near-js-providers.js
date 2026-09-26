import { JsonRpcProvider } from '@near-js/providers';
export const call = (url, p) => new JsonRpcProvider({ url }).callFunction(p.contractId, p.method, p.args);
