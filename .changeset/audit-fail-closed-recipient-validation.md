---
"@sodax/sdk": patch
---

Validate recipient addresses fail-closed when encoding cross-chain payloads: EVM recipients must be well-formed addresses, and Bitcoin, NEAR, and Injective recipients are checked against their chain's address rules instead of being UTF-8-encoded as-is, so a malformed recipient fails before any funds move. Bitcoin on-demand withdrawal payloads also preserve the exact case of Base58Check (P2PKH/P2SH) addresses so relay-side verification accepts them.
