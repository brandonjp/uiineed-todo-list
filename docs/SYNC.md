# Optional cross-device sync (`sync.php`)

This app is normally **100% local** — todos live in your browser's `localStorage`
and never leave the device. `sync.php` is an **opt-in** backend that lets the same
list follow you across devices. If you don't deploy it, nothing changes.

## How it works

- **One JSON blob.** The whole state (todos + recycle bin + slogan + an `updatedAt`
  stamp) is stored as a single file, **outside the web root**, so it is never
  directly downloadable.
- **`GET sync.php`** returns the blob; **`PUT sync.php`** (JSON body) stores it.
  Writes are atomic (temp file + `rename`, with `LOCK_EX`) and capped at 5 MB.
- **Reconciliation is blob-level last-write-wins** by `updatedAt` (see `planSync()`
  in `public/js/app.js`): the newer whole snapshot wins, so deletions propagate.
  The one exception is the **first sync on a new device**, which *unions* local +
  remote so you never lose work the first time you connect.
- The client **probes on load** and reconciles, and **debounces a `PUT` on every
  change**. A manual **"Sync now"** lives in the ⌘K palette, the **More** menu, and
  as a clickable status row in the sidebar.

## Security model — read this

`sync.php` contains **no authentication code on purpose.** It assumes the entire
site already sits behind auth that the browser sends automatically on same-origin
requests — e.g. **HTTP Basic Auth** (see [`.htaccess.example`](../.htaccess.example)).

- Put the site behind auth **before** enabling sync, or the blob is world-readable
  and world-writable to anyone who can reach the URL.
- It is **same-origin only** — do not add CORS headers.
- The storage path is a fixed server-side constant, never built from request input,
  so there is no path-traversal vector.

## Deploying it

1. Serve the app from a **PHP-capable host** (Apache/Nginx+PHP, shared hosting, etc.).
2. Make sure the whole site is behind auth (Basic Auth is simplest — see the
   `.htaccess.example`).
3. Upload `sync.php` to the web root alongside `index.html`. That's it — on first
   write it creates a `todo-sync/` directory **one level above the web root** and
   writes `state.json` there.
   - If your document root isn't a direct child of your home directory, edit the
     `STATE_DIR` constant at the top of `sync.php` to point anywhere outside the
     web root.

## Verifying

With the site behind Basic Auth (`user:pass`):

```bash
# Empty state on a fresh install:
curl -u 'user:pass' https://YOUR-HOST/sync.php
# -> {"updatedAt":0}

# Write a blob:
curl -u 'user:pass' -X PUT -H 'Content-Type: application/json' \
  --data '{"updatedAt":1,"todos":[{"id":"t1","title":"hello","completed":false}],"recycleBin":[]}' \
  https://YOUR-HOST/sync.php
# -> {"ok":true,"updatedAt":1}

# Read it back:
curl -u 'user:pass' https://YOUR-HOST/sync.php
# -> the blob you just wrote
```

Then: add a todo in one browser, refresh a second browser — the todo appears.

## Limitations (by design)

- **Rudimentary, not real-time.** Last-write-wins on the whole blob — concurrent
  edits on two devices in the same window will keep only the most recent one.
  A page refresh is how you pull the latest.
- No conflict UI, no per-item merge, no history. If you want stronger guarantees,
  the `ROADMAP.md` §3 sketches a hosted "Sync ID" upgrade path.
