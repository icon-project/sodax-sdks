---
"@sodax/types": patch
---

Fix the EIP-55 checksum casing on three EVM token addresses: Polygon `WBTC` and `LINK`, and Base `AERO`. Each was a single flipped character, so the underlying contract bytes were always correct — but viem rejects a mixed-case address whose checksum does not verify, and it does so while encoding calldata rather than at the RPC boundary. Polygon `WBTC`/`LINK` deposits, swaps and bridges therefore threw `InvalidAddressError` before signing, and because a `multicall` encodes every target into one `aggregate3` tuple, the bad entries failed the whole batch and read *every* Polygon ERC-20 balance as zero with no error surfaced. `AERO` is listed for the staging solver only, so it affected staging swap-token consumers on Base rather than production.

A new invariant test walks the exported config and asserts every EVM address passes viem's `isAddress`, so this class of typo cannot ship again. All-lowercase addresses remain valid and unchanged.
