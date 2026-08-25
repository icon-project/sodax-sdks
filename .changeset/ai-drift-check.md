---
"@sodax/skills": patch
---

Document the new `AI Files Drift Check` CI gate in the package's maintainer guidance.

The `check:ai` sub-scripts prove the knowledge tree is structurally sound and that its code blocks
compile against the real SDK, but they cannot judge the prose those blocks sit in. A pull request
could change a service's behaviour and leave the feature knowledge describing the old one with every
check green. The new workflow scopes an audit to the knowledge files a change could invalidate, has a
read-only agent compare their claims against the source, and re-reads every cited quote before a
finding is allowed to count. It flags a claim the current source disproves and warns when new public
surface reaches no knowledge file. It reports without failing a build until the `AI_DRIFT_ENFORCE`
repository variable is set.

No shipped knowledge content changed.
