<?php
/**
 * sync.php — same-origin, single-blob sync backend for the Uiineed Todo List.
 *
 * Stores ONE JSON snapshot (todos + recycleBin + slogan + an `updatedAt` stamp)
 * and serves it back. The client uses blob-level last-write-wins by `updatedAt`
 * (see planSync() in public/js/app.js) — this script is a dumb, durable store.
 *
 *   GET            -> 200 application/json, the stored blob (or {"updatedAt":0}
 *                     when nothing has been saved yet).
 *   PUT  / POST    -> store the request body verbatim (after validating it is a
 *                     JSON object), 200 {"ok":true,"updatedAt":N}.
 *   anything else  -> 405.
 *
 * SECURITY / DESIGN NOTES
 * - Auth is a shared cookie-session guard (auth.php): the first thing this
 *   script does is todo_require_auth(), which 401s any request without a valid
 *   signed cookie. The app front door (index.php) sets that cookie via login.php,
 *   so same-origin fetches from the app carry it automatically.
 *   Same-origin only — do NOT add permissive CORS headers.
 * - The state file lives OUTSIDE the web root (one level up from this script),
 *   so it can never be downloaded directly. The path is a fixed server-side
 *   constant in store.php, NEVER built from request input — there is no
 *   path-traversal vector.
 * - Storage (path, locking, atomic write) is shared with api.php via
 *   store.php. This file's own behaviour — routes, responses, whole-blob
 *   overwrite semantics — is unchanged from before that extraction.
 * - This file is intentionally generic (no host/URL/path specifics) so it is
 *   safe to commit to the public repo.
 */

// --- Auth gate (must be first) -----------------------------------------------
require __DIR__ . '/auth.php';
todo_require_auth();
require __DIR__ . '/store.php';

// --- Helpers -----------------------------------------------------------------
function send_json($status, $payload) {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Robots-Tag: noindex, nofollow');
    echo is_string($payload) ? $payload : json_encode($payload);
    exit;
}

// --- Routing -----------------------------------------------------------------
$method = isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : 'GET';

if ($method === 'GET' || $method === 'HEAD') {
    if ($method === 'HEAD') {
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        header('X-Robots-Tag: noindex, nofollow');
        exit;
    }
    // todo_store_read() already returns the {"updatedAt":0} empty shape when
    // nothing has been saved yet, so GET behaves identically pre- and
    // post-extraction.
    send_json(200, todo_store_read());
}

if ($method === 'PUT' || $method === 'POST') {
    $raw = file_get_contents('php://input');
    if ($raw === false || strlen($raw) === 0) {
        send_json(400, array('ok' => false, 'error' => 'empty body'));
    }
    if (strlen($raw) > MAX_BYTES) {
        send_json(413, array('ok' => false, 'error' => 'payload too large'));
    }

    $data = json_decode($raw, true);
    // Top-level must be a JSON object (decodes to an associative array). This
    // rejects scalars, bare strings, and malformed JSON.
    if (json_last_error() !== JSON_ERROR_NONE || !is_array($data)) {
        send_json(400, array('ok' => false, 'error' => 'invalid JSON object'));
    }

    // sync.php's contract is a whole-blob overwrite: whatever the browser
    // sends REPLACES the stored blob, same as before the store.php
    // extraction. The mutate callback ignores $current for exactly that
    // reason — the lock still buys atomicity against a concurrent writer.
    try {
        $next = todo_store_mutate(function ($current) use ($data) {
            return $data;
        });
    } catch (RuntimeException $e) {
        send_json(500, array('ok' => false, 'error' => 'write failed'));
    }

    $updatedAt = isset($next['updatedAt']) ? $next['updatedAt'] : 0;
    send_json(200, array('ok' => true, 'updatedAt' => $updatedAt));
}

header('Allow: GET, PUT, POST');
send_json(405, array('ok' => false, 'error' => 'method not allowed'));
