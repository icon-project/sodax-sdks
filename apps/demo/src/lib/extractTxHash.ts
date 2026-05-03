export function extractTxHash(result: unknown): `0x${string}` | undefined {
  if (!result || typeof result !== 'object') {
    return undefined;
  }

  const directCandidate =
    (result as { txHash?: `0x${string}`; hash?: `0x${string}` }).txHash ??
    (result as { txHash?: `0x${string}`; hash?: `0x${string}` }).hash;

  if (typeof directCandidate === 'string' && directCandidate.startsWith('0x')) {
    return directCandidate;
  }

  if ('value' in result) {
    const value = (result as { value?: unknown }).value;
    if (typeof value === 'object' && value !== null && 'spokeTxHash' in value) {
      const pair = value as { spokeTxHash?: unknown; hubTxHash?: unknown };
      const candidate = pair.spokeTxHash ?? pair.hubTxHash;
      if (typeof candidate === 'string' && candidate.startsWith('0x')) {
        return candidate as `0x${string}`;
      }
    }
  }

  return undefined;
}
