# Stellar: optional `rpcUrl`

**Additive — no action required.** Older code continues to compile.

---

## What changed

`StellarWalletConfig` (both PK and browser-extension variants) gained an optional `rpcUrl?: string` field:

```ts
type PrivateKeyStellarWalletConfig = {
  type: 'PRIVATE_KEY';
  privateKey: Hex;
  network: 'TESTNET' | 'PUBLIC';
  rpcUrl?: string;                          // ← new
  defaults?: StellarWalletDefaults;
};

type BrowserExtensionStellarWalletConfig = {
  type: 'BROWSER_EXTENSION';
  walletsKit: StellarWalletsKit;
  network: 'TESTNET' | 'PUBLIC';
  rpcUrl?: string;                          // ← new
  defaults?: StellarWalletDefaults;
};
```

If omitted, the provider falls back to a public Horizon URL chosen by `network`:
- `'PUBLIC'` → `https://horizon.stellar.org`
- `'TESTNET'` → `https://horizon-testnet.stellar.org`

## Why

Production deployments want a private Horizon (their own, or a paid provider) — public Horizon is rate-limited and not SLA-backed. Making it configurable per-construction matches every other chain in the package.

## Consumer impact

None — omitting the field works. **Recommended cleanup**: set it explicitly in production config:

```ts
new StellarWalletProvider({
  type: 'PRIVATE_KEY',
  privateKey,
  network: 'PUBLIC',
  rpcUrl: process.env.STELLAR_HORIZON_URL,
});
```

## How to verify

No verification needed — additive change. If you want to enforce the practice in your codebase, add a lint rule that flags `StellarWalletProvider` constructions without `rpcUrl`.
