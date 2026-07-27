# @sodax/swaps-api

## 2.0.0

### Minor Changes

- `@sodax/swaps-api` joins the version-aligned `@sodax/*` release group at v2.

  **Highlights (v1 → v2):**

  - Standalone type-safe HTTP client for the backend Swaps API v2 — the wire source that `@sodax/sdk`'s `sodax.api.swaps` wraps. Depends only on `@sodax/types` + `valibot`; no dependency on `@sodax/sdk`.
  - Now released in lockstep under the unified `@sdks@<version>` tag; baseline aligned to the suite. No runtime or API change in this release.

  **Reference:** [`@sodax/swaps-api` README](https://github.com/icon-project/sodax-sdks/blob/main/packages/swaps-api/README.md). SDK-side usage is covered by the `sodax-sdk` skill (`swaps-api` / `backend-api` features).

### Patch Changes

- Updated dependencies []:
  - @sodax/types@2.0.0
