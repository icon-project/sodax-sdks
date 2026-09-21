# Example interview sessions (few-shot)

Two illustrative transcripts showing how the `sodax-build` interview runs end to end — a **Tier-A** non-coder and a **Tier-C** developer. Use them as a **style reference, not a script**: one question at a time, a recommended default offered, the goal reflected back in the user's words, cross-chain led with, a short playback, then a brief + handoff. All exact chains/tokens/fees shown are **illustrative** — confirm live per the README *Source & freshness policy*.

---

## Session 1 — Tier A (non-coder): a cross-chain payments app

**User:** I'm not a developer. I want people to pay a friend who keeps their money on a different blockchain. Can I build that on SODAX?

**sodax-build:** You can — moving money *between* different chains is exactly SODAX's strength. First, so I pitch this right: are you more comfortable thinking about the *product* (no code), or do you also write some code? (Most non-developers pick the first — totally fine.)

**User:** Just the product. No code.

**sodax-build:** Great — I'll keep it plain and suggest defaults you can just confirm. In one or two sentences: what do you want people to be able to *do*?

**User:** Send money to someone, even if that person uses a different chain than they do.

**sodax-build:** So the core action is "send value from my chain to my friend on their chain." One question: should your friend receive the **same coin** you sent, or is a **different coin** on their side fine?

**User:** Same coin for v1.

**sodax-build:** Then the core feature is a **bridge** (same coin, different chain) — and the whole thing is cross-chain, which is where SODAX shines. (If later you want the friend to receive a *different* coin, that's a **swap** — a phase 2.) Do you want to earn from this — now, later, or keep it free?

**User:** A small fee would be nice, eventually.

**sodax-build:** Noted — a small **partner fee** (your cut on each transfer); we'll mark it "later, small, disclosed" and not block v1 on it. For chains, a good start is **two EVM chains** (one major chain plus one lower-fee chain — confirmed against live source). Sound right, or do you have chains in mind?

**User:** That default is fine.

**sodax-build:** Here's the plan in plain bullets — tell me if anything's off:
> - **Who/what:** let someone send the *same* coin to a friend on another chain.
> - **SODAX features:** bridge (core), partner fee (later).
> - **Chains (v1):** two EVM chains, confirmed live. EVM-only → no extra wallet work.
> - **Phase 1 goal:** one real cross-chain transfer, wallet connected.
> - **Out of scope (v1):** receiving a different coin, non-EVM chains, the fee.

**User:** Perfect.

**sodax-build:** I'll write that up as a product brief (`./product-briefs/cross-chain-payments.md`) and end with a handoff:

> **Handoff:** web app with a wallet → load the `sodax-wallet-sdk-react` skill (integration), then the `sodax-dapp-kit` skill for the bridge feature. Start from the demo app's provider setup. Phase-1 goal: one working cross-chain transfer in the safest supported environment.

```yaml
handoff:
  skills:
    - sodax-wallet-sdk-react
    - sodax-dapp-kit
  mode: integration
  partner_fee: false        # deferred to a later phase
  non_evm_chains: []
  starter_app: apps/demo
  phase1_goal: "one working cross-chain same-coin transfer across two EVM chains"
```

— then it **stops**. It does not write the app code.

---

## Session 2 — Tier C (developer): a backend cross-chain swap bot

**User:** I'm a backend dev. I want a service that swaps tokens across chains for users and takes a small cut. Where do I start?

**sodax-build:** You've described the product but not picked an SDK, so a quick framing then I route you. The core is a **cross-chain swap** (different coin out, on another chain — SODAX's sweet spot) plus a **partner fee** for your cut. It's a backend service (no React), so it signs with a private-key provider. One check: are source and destination *different chains* (the cross-chain case), or also same-chain conversions?

**User:** Mostly cross-chain, occasionally same-chain.

**sodax-build:** Both are the swap feature — lead with the cross-chain path; same-chain is just source == destination. Enough to route. Brief + handoff:

> **Handoff:** backend/bot shape → load the `sodax-sdk` skill (integration) for the swap + partner feature, and the `sodax-wallet-sdk-core` skill (integration) for the chain provider that signs. Start from the node example app. Phase-1 goal: one real cross-chain swap from the service with the partner fee attached, in the safest supported environment.

```yaml
handoff:
  skills:
    - sodax-sdk
    - sodax-wallet-sdk-core
  mode: integration
  partner_fee: true
  non_evm_chains: []        # add any non-EVM chain the bot signs on
  starter_app: apps/node
  phase1_goal: "one real cross-chain swap from the backend with a partner fee"
```

— then it **stops**. (If the dev had named a hook, `Sodax`, or a provider symbol up front, the SKILL.md STOP gate would skip the interview and route immediately.)
