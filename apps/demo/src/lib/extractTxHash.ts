export function extractTxHash(result: unknown): string | undefined {
  if (!result || typeof result !== 'object') {
    return undefined;
  }

  const directCandidate =
    (result as { txHash?: unknown; hash?: unknown }).txHash ??
    (result as { txHash?: unknown; hash?: unknown }).hash;

  if (typeof directCandidate === 'string' && directCandidate.length > 0) {
    return directCandidate;
  }

  const pair = result as { srcChainTxHash?: unknown; dstChainTxHash?: unknown };
  const candidate = pair.srcChainTxHash ?? pair.dstChainTxHash;
  if (typeof candidate === 'string' && candidate.length > 0) {
    return candidate;
  }

  return undefined;
}
