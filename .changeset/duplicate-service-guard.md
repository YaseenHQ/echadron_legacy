---
"echadron": patch
---

Reject a duplicate scoped service registration instead of silently letting the last one win. A second `registerScopedService` for the same scope and id now fails with the two competing domains named, and `overrideScopedService` is the explicit way to replace one.
