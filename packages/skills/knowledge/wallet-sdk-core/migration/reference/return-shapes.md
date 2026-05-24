# Return shapes

Method return shapes that changed between RC versions.

---

## Currently: no breaking return-shape changes

All provider method return types are stable across the RC series. This file is a placeholder — future return-shape changes will be documented here in the same format used by `@sodax/sdk`'s migration docs (paired before/after shapes per method).

---

## What to check anyway

If you suspect a return shape issue:

```bash
pnpm checkTs
```

Any TypeScript error mentioning a `@sodax/wallet-sdk-core` method's return type is most likely (a) propagated from `@sodax/sdk` / `@sodax/types` (which **did** change between v1 and v2), or (b) the consumer is reading a method that **never had** the shape they expect.

For (a), open an issue with the version delta — we'll add it to this file. For (b), see [`../../integration/reference/interfaces.md`](../../integration/reference/interfaces.md) for the authoritative current shape.
