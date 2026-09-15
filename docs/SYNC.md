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
- **Every write names the version it was based on.** A `PUT` must carry
  `baseUpdatedAt` — the stored `updatedAt` the client last pulled or pushed. If
  the stored blob has moved on since (another device, or `api.php`), the write is
  refused with **409** and the current blob comes back in `current`, so a
  whole-blob push can never bury a write it never saw. The check happens under
  the storage lock, so it can't race the writer it is checking for.
- **Reconciliation compares versions, not clocks** (see `planSync()` in
  `public/js/app.js`): only this device moved → push, only the server moved →
  pull, **both moved → three-way merge** (`merge3()`) against the last agreed
  snapshot, then push. Merging per field against a common ancestor is what
  separates an edit from a deletion, so neither side's work is lost and deleted
  tasks don't come back. The one exception is the **first sync on a new device**,
  which *unions* local + remote so you never lose work the first time you connect.
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

# Write a blob (baseUpdatedAt = the stored updatedAt you just read; 0 when empty):
curl -u 'user:pass' -X PUT -H 'Content-Type: application/json' \
  --data '{"updatedAt":1,"baseUpdatedAt":0,"todos":[{"id":"t1","title":"hello","completed":false}],"recycleBin":[]}' \
  https://YOUR-HOST/sync.php
# -> {"ok":true,"updatedAt":1}
# Repeat that same command and it is refused, because the stored version is now 1:
# -> 409 {"ok":false,"error":"conflict","current":{...}}

# Read it back:
curl -u 'user:pass' https://YOUR-HOST/sync.php
# -> the blob you just wrote
```

Then: add a todo in one browser, refresh a second browser — the todo appears.

## Limitations (by design)

- **Not real-time.** The client reconciles on load, when a tab is shown again or
  regains focus, on a manual "Sync now", and whenever a save is refused as stale.
  Nothing is pushed to an idle tab in between.
- **No conflict UI and no history.** Conflicts are resolved silently by
  `merge3()`: per task and per field, the side that changed it wins, and if both
  changed the same field the local one does. If you want stronger guarantees, the
  `ROADMAP.md` §3 sketches a hosted "Sync ID" upgrade path.
