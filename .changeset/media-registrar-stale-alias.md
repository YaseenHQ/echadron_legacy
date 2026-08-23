---
"echadron": patch
---

Stop an `[unexpected]` error when a bound model alias no longer resolves. Media tool registration re-resolves the alias from persisted profile state that resume replays without checking the catalog, so an alias whose config.toml entry was removed (for example on logout) threw out of an event listener. It now degrades to registering without a model-bound video uploader.
