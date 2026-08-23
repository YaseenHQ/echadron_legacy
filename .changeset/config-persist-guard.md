---
"echadron": patch
---

Stop config writes from destroying `config.toml`. A failed read used to clear the in-memory snapshot, so the next write persisted that empty state over your file; and every write serialized a stale snapshot, so edits made outside Echadron were silently clobbered. A failed load now keeps the last-known-good values, records a diagnostic, and refuses to persist until a successful reload, while each write re-reads the file and applies only the sections it is changing on top of what is on disk.
