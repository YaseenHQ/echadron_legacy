---
"echadron": minor
---

Let users with a global (kimi.ai) Kimi Code account sign in. Echadron only ever talked to the mainland-China deployment, so a global account could not authenticate at all — and pointing `KIMI_CODE_OAUTH_HOST` at kimi.ai did not help, because the managed API base still resolved to api.kimi.com. `echadron login --region global` now selects a matching set of endpoints; omit the flag and nothing changes.
