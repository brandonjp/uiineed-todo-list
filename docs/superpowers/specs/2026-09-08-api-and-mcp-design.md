# API + MCP access for the Uiineed Todo List — design proposal

**Status:** proposed 2026-09-08, awaiting review · **Target:** the existing PHP
deployment (Apache + PHP 8.2, shared hosting) · **Repo:** public fork of
`ricocc/uiineed-todo-list`

**Reviewer:** you are being asked to poke holes in the *security model* and the
*deployment story*, not the code style. The three questions worth your attention
are flagged inline as **REVIEW-1/2/3**.

---

## 1. What this proposes

Two capabilities, plus one bug fix:

1. **A token-authenticated REST API** (`api.php`) so non-browser clients can read
   and write the todo list.
2. **A local MCP server** (`mcp/todo-mcp.mjs`) so Claude can manage the list as
   a set of tools, without any new publicly reachable service.
3. **Removal of a hardcoded hostname** from `login.php`, which should never have
   been baked into source in a repo that is published.

## 2. Why this is safe to do in a public repo

The repository is public and will stay public. The property that makes that fine
is already established in this codebase and every change below preserves it:

> **The repo holds mechanism. The server holds material.**

`auth.php` and `sync.php` are deliberately generic and load every secret from
`~/todo-auth/config.php`, one directory above the web root, `chmod 600`, never
committed. Deployment specifics live in a git-ignored `DEPLOY.local.md`.
Publishing the cookie-HMAC scheme, the sync protocol, and — after this work —
the API's token-verification code costs nothing, because none of them are
secret. The key material is the secret, and it is not in the repo.

Concretely, this proposal adds **exactly one new secret** (a set of API tokens),
and it is stored as additional keys in the config file that already exists. No
new file needs to be git-ignored, and no `.gitignore` change is required.

**REVIEW-1:** Is that claim actually true of everything below? The failure mode
this project cares about is a deployment detail leaking into source by accident
— which has happened once already (a server shell username in a design doc,
redacted 2026-09-07 but still present in published history via the fork network).

## 3. Threat model

**Assets:** the contents of one person's todo list, and shell access to a shared
hosting account.

**In scope:**
- Anonymous internet traffic hitting the app's endpoints.
- Anyone reading the public source to look for a weakness.
- Token theft from the client machine's disk.

**Explicitly out of scope:**
- Multi-user access control. This is a single-secret, single-owner app and stays
  that way. There are no roles, no per-user data, no sharing.
- Malicious insiders on the shared host.
- Traffic analysis / metadata.

**Standing constraints, carried from the existing deployment:**
- HTTPS is forced at the Apache layer; the session cookie is `Secure`+`HttpOnly`.
- `noindex` is set in `robots.txt`, an `X-Robots-Tag` header, and page meta.
- **No CORS headers, ever.** Same-origin only. A permissive
  `Access-Control-Allow-Origin` would let any page the owner visits drive the API
  with the browser's ambient credentials.

---

## 4. Design

### 4.1 Site name — remove the hardcoded hostname

`login.php` currently hardcodes `todo.bpf.fyi` in its `<title>` and `<h1>`. That
is a deployment detail in published source. Fix:

Add to `auth.php`:

```php
/**
 * Display name for this deployment. Never hardcoded — resolved per request.
 *
 * Order: an explicit `site_name` in the out-of-web-root config, else the
 * request's own Host header, else a neutral fallback.
 *
 * NOTE: HTTP_HOST is client-controlled. The return value is therefore for
 * DISPLAY ONLY and every caller MUST escape it. It is never used to build a
 * URL, a redirect target, or a cookie domain — all redirects in this codebase
 * are relative (`Location: index.php`).
 */
function todo_site_name() {
    $cfg = todo_auth_config();
    if (!empty($cfg['site_name'])) return $cfg['site_name'];
    if (!empty($_SERVER['HTTP_HOST'])) return $_SERVER['HTTP_HOST'];
    return 'Todo';
}
```

`login.php` then renders:

```php
<title><?php echo htmlspecialchars(todo_site_name(), ENT_QUOTES, 'UTF-8'); ?> — sign in</title>
...
<h1><?php echo htmlspecialchars(todo_site_name(), ENT_QUOTES, 'UTF-8'); ?></h1>
```

With no config change at all, an existing deployment keeps showing its own
hostname — the behaviour is identical, the string is just no longer in git. A
deployment that wants a friendlier label sets `'site_name' => 'My Todos'`.

`index.php` and `index-zh.php` are **not** changed: their titles are the
upstream project's generic marketing titles, contain no deployment detail, and
are part of the fork's public identity.

**REVIEW-2:** Host-header reflection into a page is a known XSS-adjacent
footgun. The mitigation here is (a) `htmlspecialchars` with `ENT_QUOTES` at
every call site, and (b) the value never reaching a URL, header, or redirect.
Apache also rejects malformed Host values before PHP sees them. Is escaping at
the call site sufficient, or should `todo_site_name()` additionally reject any
host not matching `^[A-Za-z0-9.:-]+$` and fall through to `'Todo'`? The
whitelist is three lines and costs nothing — the argument against is only that
it is redundant.

### 4.2 API authentication — bearer tokens

Browser sessions keep using the signed cookie. Machine clients cannot fill in an
HTML login form, so they get named bearer tokens.

New optional key in `~/todo-auth/config.php`:

```php
<?php return [
  'password_hash' => '$2y$12$…',
  'signing_key'   => '<64 hex chars>',
  'site_name'     => 'My Todos',          // optional, §4.1
  'api_tokens'    => [                     // optional, this proposal
    'macbook-mcp' => '<sha256 hex of the token>',
    'iphone-shortcut' => '<sha256 hex of the token>',
  ],
];
```

Verification in `auth.php`:

```php
/** Extract the bearer token from the request, or '' if absent. */
function todo_bearer_token() {
    // Apache with PHP as CGI/FastCGI strips Authorization unless it is
    // explicitly passed through — see §6 for the required .htaccess line.
    $hdr = '';
    if (!empty($_SERVER['HTTP_AUTHORIZATION'])) {
        $hdr = $_SERVER['HTTP_AUTHORIZATION'];
    } elseif (!empty($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) {
        $hdr = $_SERVER['REDIRECT_HTTP_AUTHORIZATION'];
    }
    if (stripos($hdr, 'Bearer ') !== 0) return '';
    return trim(substr($hdr, 7));
}

/** Name of the token presented, or null. Constant-time, no early exit. */
function todo_api_identity() {
    $cfg = todo_auth_config();
    if (empty($cfg['api_tokens']) || !is_array($cfg['api_tokens'])) return null;

    $token = todo_bearer_token();
    if ($token === '') return null;
    $presented = hash('sha256', $token);

    // Compare against EVERY configured token even after a match, so response
    // time does not reveal how many tokens exist or where in the list a hit is.
    $found = null;
    foreach ($cfg['api_tokens'] as $name => $expected) {
        if (hash_equals((string) $expected, $presented)) $found = $name;
    }
    return $found;
}
```

**Decisions and why:**

- **SHA-256, not bcrypt, for token storage.** Tokens are 32 bytes from
  `random_bytes()` — 256 bits of entropy. There is no dictionary to attack, so
  the slow-hash property bcrypt buys for human passwords is worthless here,
  while its ~250ms cost would be paid on *every* API request. The passphrase
  login keeps bcrypt, correctly, because a human chose that secret.
- **Hashes in config, not raw tokens.** Reading the config file does not hand
  over usable credentials.
- **Named tokens.** Revoking one device is deleting one line; it does not sign
  the browser out or invalidate other clients. Contrast the cookie scheme, where
  rotating the signing key deliberately logs out everything.
- **No token expiry.** Single-owner app, revocation is a config edit, and an
  expiring token that silently stops working mid-task is worse than the risk it
  removes. Rotation is manual and documented.
- **No brute-force lockout and no rate limiting.** Guessing a 256-bit token is
  not a threat that rate limiting meaningfully improves, and a lockout is a
  denial-of-service vector against the one legitimate user. (The passphrase
  login keeps its existing 2-second delay, which *is* worth having, because that
  secret is human-chosen.)
- **No failure logging.** Writing attacker-controlled strings to a log file on
  shared hosting adds a disk-growth and log-injection surface for no benefit
  here.

### 4.3 `api.php` — the endpoint

A new file, deliberately **separate from `sync.php`**. Rationale: `sync.php` is
the browser's whole-blob channel and is working; it keeps its cookie-only
posture and is not modified except to share storage code (§4.4). `api.php` is
the machine channel, with different auth and a different shape. Separating them
means the API cannot regress the app, and each file stays small enough to read
in one sitting.

Auth gate, first thing in the file:

```php
require __DIR__ . '/auth.php';
require __DIR__ . '/store.php';

// Either a valid bearer token OR a valid browser cookie. Cookie is allowed so
// the endpoint can be exercised from a logged-in browser tab while debugging.
if (todo_api_identity() === null && !todo_is_authed()) {
    http_response_code(401);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo '{"ok":false,"error":"unauthorized"}';
    exit;
}
```

**Routing** uses query parameters, not path segments. `PATH_INFO` behaviour
varies across shared-hosting PHP handlers and would need a rewrite rule to be
reliable; query parameters work everywhere with no Apache configuration:

- `GET    api.php?resource=tasks` → `{"ok":true,"tasks":[…],"updatedAt":N}`
- `POST   api.php?resource=tasks` → body `{"title":"…"}` → creates, returns the new task
- `PATCH  api.php?resource=tasks&id=<id>` → body `{"completed":true}` and/or `{"title":"…"}`
- `DELETE api.php?resource=tasks&id=<id>` → moves the task to the recycle bin
- anything else → `405` with an `Allow` header

Responses are always JSON with `Cache-Control: no-store` and
`X-Robots-Tag: noindex, nofollow`.

**Data contract.** The API reads and writes the *same* blob `sync.php` serves, so
a change made by Claude appears in the browser and vice versa. The stored shape,
taken verbatim from `buildSyncPayload()` in `public/js/app.js`:

```json
{
  "version": 1,
  "updatedAt": 1757000000000,
  "slogan": "…",
  "todos":      [ { "id": "t…", "title": "…", "completed": false, "removed": false, "createdAt": 1757000000000 } ],
  "recycleBin": [ { "id": "t…", "title": "…", "completed": false, "removed": true,  "createdAt": 1757000000000 } ]
}
```

**Id minting must match the client**, or the browser's dedupe and sort logic will
mis-handle API-created tasks. `genId()` in `app.js` produces
`'t' + Date.now().toString(36) + '-' + counter.toString(36)`, and `idTime()`
parses that back with the regex `^t([0-9a-z]+)-[0-9a-z]+$` to recover a sort key.
The PHP equivalent:

```php
/** Mint an id in the exact format public/js/app.js genId() produces. */
function todo_gen_id($ms, $counter) {
    return 't' . base_convert((string) $ms, 10, 36) . '-' . base_convert((string) $counter, 10, 36);
}
```

Note `base_convert()` is lossy above 2^53; millisecond timestamps are ~2^41, so
this is safe until the year 3084. Verified 2026-09-08: for ms=1757000000000, counter=5, both JS `genId()` and the PHP above produce `tmf5kfojk-5`, and it round-trips through the client's `idTime()` regex. New tasks also get `createdAt` set to the same
millisecond value, matching `backfillCreatedAt()`'s expectations.

Every mutating request sets `updatedAt` to the current millisecond timestamp,
which is what makes the browser's existing `planSync()` pull the remote copy on
next load. **This is the one piece that must not be got wrong** — an API write
that leaves `updatedAt` stale would be silently discarded by the next browser
sync.

### 4.4 `store.php` — shared, locked storage

Today `sync.php` owns the state file inline. The API needs read-modify-write
(fetch blob → change one task → write blob), which the current
write-only-whole-blob helper does not support safely. Extract both into a shared
`store.php` that `sync.php` and `api.php` both require:

```php
define('STATE_DIR',  dirname(__DIR__) . '/todo-sync');
define('STATE_FILE', STATE_DIR . '/state.json');
define('LOCK_FILE',  STATE_DIR . '/state.lock');
define('MAX_BYTES',  5 * 1024 * 1024);

/** Run $fn under an exclusive lock, passing it the decoded blob; whatever it
 *  returns is written back atomically. Returns the written blob. */
function todo_store_mutate(callable $fn) { /* flock LOCK_EX, read, $fn, atomic rename, release */ }

/** Read the current blob without taking the write lock. */
function todo_store_read() { /* returns array, or the empty {"updatedAt":0} shape */ }
```

`sync.php`'s external behaviour is unchanged — same routes, same responses, same
atomic temp-file-then-rename write. It just calls into `store.php`.

**On concurrency.** The owner has stated the browser and the API are not used
simultaneously, so full compare-and-swap (rejecting a write whose `updatedAt`
does not match what is stored) is **deferred, not adopted**. What the lock above
*does* buy, for a few lines, is that two overlapping API calls cannot interleave
their read-modify-write cycles and lose one of the two tasks. That is a real and
easy-to-hit failure — an MCP client issuing two `add_task` calls back to back —
whereas the browser-versus-API race requires actual simultaneous use.

**REVIEW-3:** The residual risk this accepts is a *stale browser tab*, not
simultaneous use: a tab left open on a phone can push its older in-memory blob
on wake and overwrite tasks the API added in the meantime, because
`planSync()` resolves by comparing whole-blob timestamps and the tab believes
its own state is current. Is that acceptable, or is an `If-Match: <updatedAt>`
precondition on the API's writes worth the extra client round-trip? The
owner's call; flagged because the reason it is safe is narrower than
"I don't use both at once."

### 4.5 `mcp/todo-mcp.mjs` — the MCP server

A **local stdio** MCP server on the owner's machine that calls the API over
HTTPS. Rejected alternative: hosting an MCP server on the web host — that adds a
second publicly reachable endpoint, requires the Streamable-HTTP session
handshake (`initialize` → read `Mcp-Session-Id` → `notifications/initialized` →
`tools/list`, all carrying the session header), and buys nothing for a
single-user setup.

**Zero dependencies, no `package.json`.** The project's defining constraint is
that it is build-free — no bundler, no npm install, Vue vendored as a file — and
the existing test suite runs as plain `node test/logic.test.js`. Adding
`@modelcontextprotocol/sdk` would introduce the first `package.json` and a
`node_modules` tree. MCP over stdio is newline-delimited JSON-RPC 2.0, and only
three methods are needed (`initialize`, `tools/list`, `tools/call`), so the
hand-rolled server is roughly 150 lines. The tradeoff is real and worth stating
plainly: the SDK would track protocol revisions automatically, and this will
not.

**Tools exposed:** `list_tasks` (optional `filter`: `all|active|completed`),
`add_task` (`title`), `complete_task` (`id`), `delete_task` (`id`).

**Credentials.** The server reads `TODO_API_URL` and `TODO_API_TOKEN` from the
environment, and if either is unset, falls back to sourcing
`~/.config/creds/todo.env` — the machine's established location for
credentials, outside any git repo and outside Dropbox. This keeps the token out
of the repo *and* out of `~/.claude.json`. Values in that file must be
**single-quoted**, and the file is `chmod 600`:

```
TODO_API_URL='https://<host>/api.php'
TODO_API_TOKEN='<64 hex chars>'
```

The server never logs the token, and never echoes a request body containing it.

---

## 5. What is deliberately not being built

- **Multi-user auth, OAuth, JWT.** Single-owner app. A JWT here would be a
  bearer token with extra parsing bugs available.
- **CORS support.** §3.
- **Webhooks / push.** No use case.
- **A public read-only mode.** The app is `noindex` and passphrase-gated on
  purpose.
- **Token expiry, refresh tokens, or a token-management UI.** Config edit +
  documented rotation is proportionate.
- **Rate limiting.** §4.2.

---

## 6. Deployment steps

Ordered, and each one is reversible.

1. **Pass the `Authorization` header through to PHP.** This is the single most
   likely thing to break, and it fails in a confusing way: the code is correct,
   the token is correct, and every request still returns `401`, because Apache
   running PHP as CGI/FastCGI drops the `Authorization` header before PHP sees
   it. Add to the real (git-ignored) `.htaccess`, and to the committed
   `.htaccess.example` so the requirement is documented publicly:

   ```apache
   # Pass the Authorization header through to PHP (CGI/FastCGI strips it).
   <IfModule mod_rewrite.c>
       RewriteEngine On
       RewriteRule .* - [E=HTTP_AUTHORIZATION:%{HTTP:Authorization}]
   </IfModule>
   # Apache 2.4.13+ alternative, if mod_rewrite is unavailable:
   # CGIPassAuth On
   ```

2. **Mint a token and store its hash.** On the server, never in shell history
   and never in a command argument:

   ```bash
   php -r '$t=bin2hex(random_bytes(32)); echo "TOKEN: $t\nHASH:  ".hash("sha256",$t)."\n";'
   ```

   Put the **hash** in `~/todo-auth/config.php` under `api_tokens`; put the
   **token** straight into `~/.config/creds/todo.env` on the client machine and
   into a password manager. Then clear the terminal scrollback.

3. **Deploy `store.php`, `api.php`, the `auth.php` additions, and the
   `login.php` change.**

4. **Verify (§7) before wiring the MCP server.**

5. **Register the MCP server** in `~/.claude.json` pointing at
   `mcp/todo-mcp.mjs`, with no token inline — the server reads
   `~/.config/creds/todo.env` itself.

---

## 7. Verification

Run in this order; each is a hard gate.

```bash
# Syntax
php -l auth.php && php -l api.php && php -l store.php && php -l login.php

# Existing behaviour is not regressed
node test/logic.test.js
curl -sI https://<host>/            # expect 302 -> login.php
curl -sI https://<host>/sync.php    # expect 401

# The header actually arrives (step 6.1) — this is the classic failure
curl -s -o /dev/null -w '%{http_code}\n' \
     -H "Authorization: Bearer $TODO_API_TOKEN" 'https://<host>/api.php?resource=tasks'
# expect 200. A 401 here with a known-good token means .htaccess step 1 did not take.

# Auth negatives
curl -s -o /dev/null -w '%{http_code}\n' 'https://<host>/api.php?resource=tasks'                       # 401
curl -s -o /dev/null -w '%{http_code}\n' -H 'Authorization: Bearer wrong' 'https://<host>/api.php?resource=tasks'  # 401

# Round trip
curl -s -X POST -H "Authorization: Bearer $TODO_API_TOKEN" -H 'Content-Type: application/json' \
     -d '{"title":"proposal smoke test"}' 'https://<host>/api.php?resource=tasks'
# then load the app in a browser and confirm the task is visible and sorts correctly
```

New automated tests, following the repo's zero-dependency convention
(`test/logic.test.js` runs as plain `node`, no npm):

- `test/auth.test.php`, run as `php test/auth.test.php` — covers
  `todo_api_identity()` accepting a good token, rejecting a wrong one, rejecting
  an absent header, and returning the correct *name*; plus `todo_site_name()`
  resolution order.
- Extend `test/logic.test.js` with a case asserting that an id minted by the PHP
  formula parses correctly under `idTime()`, so the two implementations cannot
  drift apart silently.

---

## 8. Build order

Each step ends with something independently testable and committable.

1. **Site name** (§4.1) — smallest, isolated, fixes a live leak. Ships alone.
2. **`store.php` extraction** (§4.4) — pure refactor, no behaviour change; the
   existing `sync.php` curl checks are the regression test.
3. **Token auth in `auth.php`** (§4.2) + `test/auth.test.php`. No endpoint yet,
   so nothing is exposed.
4. **`.htaccess` passthrough** (§6.1) + verify the header arrives. Doing this
   *before* the endpoint exists means the confusing failure is diagnosed in
   isolation.
5. **`api.php` read-only** (`GET` only) + curl verification.
6. **`api.php` writes** (`POST`/`PATCH`/`DELETE`) + the id-format test.
7. **MCP server** (§4.5) — last, because everything it depends on is proven by
   then.

Version bump and `CHANGELOG.md` entry at each of steps 1, 5, 6, and 7 (the ones
that change shipped behaviour); steps 2–4 are internal.

---

## 9. Open questions for the reviewer

- **REVIEW-1 (§2):** does anything here reintroduce deployment detail into
  source?
- **REVIEW-2 (§4.1):** is escaping `HTTP_HOST` at each call site enough, or add
  the character whitelist?
- **REVIEW-3 (§4.4):** is the stale-tab overwrite an acceptable residual risk,
  or is `If-Match` worth building now?
- Anything in §5 ("not being built") that you think is actually load-bearing.
