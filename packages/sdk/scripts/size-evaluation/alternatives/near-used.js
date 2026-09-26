import { JsonRpcProvider } from 'near-api-js';
export const call = (url, p) => new JsonRpcProvider({ url }).callFunction(p);
