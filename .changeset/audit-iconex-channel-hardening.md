---
"@sodax/wallet-sdk-react": patch
---

Harden the ICONEX relay channel: requests are serialized and correlated by expected response type with a timeout instead of resolving on the first relay event of any type, returned addresses are validated before being stored, background reconnects during store hydration use a 30-second timeout so they cannot hold an interactive connect behind them, and reconnect failures surface to the caller instead of being swallowed.
