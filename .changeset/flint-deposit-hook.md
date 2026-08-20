---
"@sodax/types": minor
"@sodax/sdk": minor
---

Add `HookKind.FLINT_DEPOSIT`, a delivery hook that requests an ERC-7540 deposit of an intent's USDC
output into the Flint RWA vault on Ethereum (a Lagoon v0.6.0 vault, "Flint USD" / flUSD) instead of
transferring the USDC to the recipient. The recipient becomes the deposit request's **controller**, so
the pending request — and the flUSD shares it settles into — belong to the user. Deposits are
asynchronous: `requestDeposit` mints nothing, and shares appear only once Flint's curator settles a NAV
and claims on the controller's behalf.

The hook's `deliveryData` is `abi.encode(address recipient)`, the same 32-byte payload shape HyperCore
uses, and `HookRequest` gains a `{ kind: FLINT_DEPOSIT }` member that needs no extra params — the
recipient comes from `dstAddress`, and referral attribution is configured on the deployed contract.

**The hook is not usable yet.** `FlintDepositHook` is not deployed to Ethereum mainnet, so it has no
entry in the `spokeHooks` registry. Selecting it fails closed at intent-construction time:
`getSpokeHook` returns `undefined`, `isHookSupportedToken` returns `false`, and `resolveDeliveryHook`
throws. A placeholder address was deliberately not used, because a registry address becomes an intent's
`dstAddress` and would receive real funds. The registry entry lands with the deployment.

`HookService.encodeDeliveryData` now rejects a zero-address recipient. This applies to every hook, not
just Flint: a zero recipient makes the destination receiver revert, which rolls back the whole
cross-chain withdrawal and wedges the message unrecoverably, so it is now caught client-side before an
intent exists.
