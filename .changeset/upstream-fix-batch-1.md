---
"echadron": patch
---

Port a batch of upstream reliability fixes: the kap-server WebSocket now heartbeats so proxies stop dropping idle sessions, footer git-status commands resolve through PATH instead of the working directory, background task output is sanitized before display, the banner stays readable with long tags on narrow terminals, Windows explorer `/select,` handles quoted paths, question ids containing colons resolve, Gemini tool-call thought signatures keep their order, and a cron turn ending no longer hides the previous answer.
