Control the user's real browser — the one they are signed into — to open pages, read them, click, type, and screenshot.

Reach for this when the task needs a live, logged-in page: something behind a sign-in, a single-page app that renders nothing useful without JavaScript, or a flow you must click through. For a plain public page, `FetchURL` is cheaper and does not touch the user's browser.

Actions:
- `navigate` — open `url` and wait for load. Returns the settled url and title.
- `read` — the visible text of the current page.
- `click` — click the first element matching `selector`.
- `type` — focus `selector` and enter `text` as real key events.
- `screenshot` — a PNG of the viewport.

The browser is the user's own, and stays open afterwards. Nothing runs headless, and no session is created or destroyed.

Two backends serve this, whichever is reachable. Echadron talks the Chrome DevTools Protocol to a Chrome or Edge started with `--remote-debugging-port=9222`. If a Kimi WebBridge daemon is already running on the machine, it is used instead. When neither is available the error says how to start one — relay it to the user rather than retrying.
