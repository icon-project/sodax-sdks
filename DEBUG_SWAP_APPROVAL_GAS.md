# Swap Approval Gas Estimation Debug Guide

This guide will help you collect data about the high gas estimates for USDT → ETH swaps.

## Quick Start

1. **Checkout this branch locally:**
   ```bash
   git checkout debug/swap-approval-gas-estimate
   pnpm install
   pnpm build:packages
   ```

2. **Pick your environment** (one of these):
   - `apps/demo` — Full React dapp with wallet UI
   - `apps/swap-api-example` — Standalone swap API client
   - `apps/wallet-modal-example` — Wallet modal reference

3. **Start the dev server:**
   ```bash
   cd apps/demo  # (or the app you picked)
   pnpm dev
   ```

4. **Open in browser and open DevTools** (F12):
   - Console tab
   - Network tab (optional, for TX inspection)

---

## Debug Steps

### Step 1: Trigger the Approval

1. Navigate to the swap page
2. **Select: USDT → ETH** (or your failing token pair)
3. **Enter amount** (anything > 0)
4. **Click "Approve"** button (NOT swap yet)
5. **Do NOT confirm in MetaMask yet** — we need to capture data first

### Step 2: Capture Console Output

When you click Approve, watch the **Console tab** for logs starting with `[SODAX-DEBUG] Approval Transaction`.

**Copy everything from that log block.** It will show:
- Transaction type (standalone vs multicall)
- Spender address
- Calldata hex
- Whether it's a multicall batch operation

**In the console, also run:**
```javascript
// Check what the last approval looked like
copy(__SODAX_LAST_APPROVAL_DEBUG__)
```

Paste that into a notepad or text editor.

### Step 3: MetaMask Gas Estimation Snapshot

Before confirming the approval in MetaMask:

1. Open MetaMask popup
2. **Take a screenshot** of the gas estimation (like you showed earlier)
3. Click "Edit gas fee" to see the breakdown
4. Note:
   - Current gas price (Gwei)
   - Estimated gas limit
   - Low/Market/Advanced options

### Step 4: MetaMask Developer Tools

In MetaMask, you can inspect the raw transaction:

1. In the MetaMask approval screen, right-click → **Inspect**
2. In DevTools, go to **Application** tab → **Local Storage** → `https://your-site`
3. Look for any pending transaction data
4. Or, in MetaMask directly: Settings → Security & Privacy → check if developer mode logs are available

### Step 5: Broadcast and Inspect on-chain

If you're comfortable confirming the approval:

1. **Confirm in MetaMask** and let it execute
2. Once confirmed, **copy the transaction hash** from MetaMask
3. **Open Etherscan** and search for that TX hash
4. Screenshot the "Input Data" section — this shows the actual calldata sent

**Key things to look for in Etherscan:**
- The **Function** name (should show `approve` or multicall function)
- The raw **Input Data** (the hex string)
- The actual **Gas Used** vs **Gas Limit** estimated

### Step 6: Compare with Uniswap

Do the same approve flow on Uniswap:

1. Go to [app.uniswap.org](https://app.uniswap.org)
2. Swap USDT → ETH (same pair/amounts)
3. Click Approve USDT
4. Screenshot the MetaMask gas estimation
5. Copy the gas limit number from MetaMask

**Compare:**
- SODAX gas estimate: `_____ Gwei`
- Uniswap gas estimate: `_____ Gwei`
- Ratio: `_____ x higher on SODAX`

---

## What to Report Back

Please provide:

1. **Console logs** from `[SODAX-DEBUG]` blocks (or `__SODAX_LAST_APPROVAL_DEBUG__`)
2. **MetaMask screenshots:**
   - SODAX approval gas estimate
   - Uniswap approval gas estimate (for comparison)
3. **Etherscan inspection** (if you confirmed):
   - The Function name (approve vs multicall)
   - The Input Data (hex calldata, just first 100 chars is enough)
   - Actual Gas Used vs Gas Limit
4. **App info:**
   - Which SODAX app (demo, swap-api-example, etc.)
   - Network (mainnet, testnet, which?)
   - Token pair exact addresses if possible

---

## Advanced Debug (if comfortable with code)

### Enable Extra Logging

In your browser console, before clicking Approve:

```javascript
// Enable verbose logging
localStorage.setItem('DEBUG', 'sodax:*');
window.location.reload();
```

This will show more detailed logs from the SDK.

### Capture Network Tab

1. Open **Network tab** in DevTools
2. Click **Preserve logs** checkbox
3. Trigger the approval
4. Look for any RPC calls to your provider:
   - `eth_estimateGas` — the call that estimates gas
   - `eth_sendTransaction` — the actual approval TX

Right-click on these → **Copy as cURL** and save. This shows us what parameters were sent to the RPC node.

### Check the Built SDK Code

After `pnpm build:packages`, look at:
- `packages/sdk/dist/index.d.ts` — TypeScript definitions
- `packages/sdk/dist/index.js` — The built JS (look for approve calls)

This confirms if approval is truly standalone or bundled.

---

## Troubleshooting

**Q: No `[SODAX-DEBUG]` logs appearing?**
- Check if you're using the latest build (`pnpm build:packages`)
- Make sure you're on the `debug/swap-approval-gas-estimate` branch
- Check console filters — make sure you're not filtering out logs

**Q: MetaMask not showing the approval transaction?**
- Try switching to Ethereum Mainnet
- Clear MetaMask cache: Settings → Clear Activity Tab Data
- Refresh the page and try again

**Q: Not sure which spender/intentsContract address is being used?**
- Run in console: `copy(sodax.config)` to dump the full SDK config
- Look for `solver.intentsContract` or `addresses.assetManager`

---

## Useful Console Commands

Once the page loads with the SDK running, try these in console:

```javascript
// Check SDK config
window.sodax?.config

// Check the last approval debug info
__SODAX_LAST_APPROVAL_DEBUG__

// Get current allowance
// (replace with real token/spender/owner addresses)
```

---

## Once You Have Data

1. **Push this branch** with any changes you made
2. **Reply in the issue/PR** with the console logs and screenshots
3. **Include:** which app, which network, token addresses if possible

This will let us pinpoint exactly where the high gas estimate is coming from.
