---
"echadron": patch
---

File tools on Windows now understand Git Bash paths. A model-supplied POSIX path like `/c/Users/you/project` is translated to its win32 form before the path is canonicalized and checked against the workspace, so reads and writes stop failing on paths the shell itself accepts. Drive-letter forms translate lexically, root-relative paths resolve through `cygpath -w` with per-segment caching, and every failure mode falls back to the previous behaviour.
