# @sodax/libs

## 2.0.0

### Patch Changes

- Internal-only package — do not depend on `@sodax/libs` directly.

  **Highlights (v1 → v2):**

  - Dependency-isolation layer + curated stable third-party re-export subpaths. Consumed transitively by `@sodax/sdk`, `@sodax/wallet-sdk-core`, and `@sodax/wallet-sdk-react`.
  - Published publicly only so transitive installs resolve; deprecated on npm. Subpaths may be removed without notice when upstream bundler bugs are fixed.
  - Version aligned to the `@sodax/*` suite (fixed release group).

  **Reference:** [`@sodax/libs` AGENTS.md](https://github.com/icon-project/sodax-sdks/blob/main/packages/libs/AGENTS.md).
