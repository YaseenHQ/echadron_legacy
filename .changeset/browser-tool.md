---
"echadron": minor
---

New `Browser` tool: drive your own signed-in browser to open pages, read them, click, type and screenshot. Useful when a task needs a live page behind a login or one that renders nothing without JavaScript — `FetchURL` stays the cheaper choice for plain public pages. Echadron talks the Chrome DevTools Protocol to a Chrome or Edge you started with `--remote-debugging-port=9222`; if a Kimi WebBridge daemon is already running it is used instead. The browser is yours and stays open; nothing runs headless.
