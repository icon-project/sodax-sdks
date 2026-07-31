import { type Hex } from 'viem';

/**
 * Debug utility for swap approval gas estimation issues.
 * Log this information when approvals are being constructed and sent to MetaMask.
 */
export interface ApprovalDebugInfo {
  timestamp: string;
  txType: 'standalone' | 'multicall' | 'bundled';
  fromAddress: string;
  tokenAddress: string;
  spenderAddress: string;
  approvalAmount: string;
  calldata: string;
  calldataLength: number;
  isMulticall: boolean;
  operationCount?: number;
}

export function debugApproval(info: Omit<ApprovalDebugInfo, 'timestamp' | 'calldataLength'>): ApprovalDebugInfo {
  const debugInfo: ApprovalDebugInfo = {
    timestamp: new Date().toISOString(),
    ...info,
    calldataLength: info.calldata.length,
  };

  console.group(
    `%c[SODAX-DEBUG] Approval Transaction%c ${info.txType.toUpperCase()}`,
    'color: #ff6b6b; font-weight: bold',
    'color: #4ecdc4; font-weight: bold',
  );
  console.log('Timestamp:', debugInfo.timestamp);
  console.log('Approval Type:', debugInfo.txType);
  console.log('From:', debugInfo.fromAddress);
  console.log('Token:', debugInfo.tokenAddress);
  console.log('Spender:', debugInfo.spenderAddress);
  console.log('Amount:', debugInfo.approvalAmount);
  console.log('Calldata:', debugInfo.calldata);
  console.log('Calldata Length (bytes):', debugInfo.calldataLength);
  console.log('Is Multicall:', debugInfo.isMulticall);
  if (debugInfo.operationCount) {
    console.log('Operations in Multicall:', debugInfo.operationCount);
  }
  console.groupEnd();

  // Also log to window for easy copy-paste in DevTools
  if (typeof window !== 'undefined') {
    (window as any).__SODAX_LAST_APPROVAL_DEBUG__ = debugInfo;
    console.log('%cℹ️ Copy debug info: copy(__SODAX_LAST_APPROVAL_DEBUG__)', 'color: #999; font-style: italic');
  }

  return debugInfo;
}

/**
 * Determine if calldata represents a multicall operation.
 * Multicalls typically have the selector 0x1cff9cd6 or similar batch operation patterns.
 */
export function isMulticallCalldata(calldata: Hex): boolean {
  // Multicall3 selector (0x5e6e4794)
  // Multicall selector (0x1cff9cd6)
  // Standard approve selector (0x095ea7b3)
  return !calldata.toLowerCase().startsWith('0x095ea7b3');
}

/**
 * Parse ERC-20 approve calldata to extract spender and amount.
 * Approve selector: 0x095ea7b3
 * Parameters: address spender, uint256 amount
 */
export function parseApproveCalldata(calldata: Hex): { spender: string; amount: bigint } | null {
  if (!calldata.toLowerCase().startsWith('0x095ea7b3')) {
    return null;
  }

  try {
    // Skip '0x095ea7b3' (10 chars = 4 bytes selector)
    const params = '0x' + calldata.slice(10);

    // First 32 bytes = spender address (padded to 32 bytes)
    const spenderPadded = params.slice(0, 66); // 0x + 64 hex chars
    const spender = '0x' + spenderPadded.slice(-40); // Last 40 chars = address

    // Next 32 bytes = amount
    const amountHex = '0x' + params.slice(66, 130);
    const amount = BigInt(amountHex);

    return { spender, amount };
  } catch {
    return null;
  }
}
