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
 *   constant, NEVER built from request input — there is no path-traversal vector.
 * - This file is intentionally generic (no host/URL/path specifics) so it is
 *   safe to commit to the public repo. Adjust STATE_DIR below only if your
 *   deployment puts the document root somewhere unusual.
 */

// --- Auth gate (must be first) -----------------------------------------------
require __DIR__ . '/auth.php';
todo_require_auth();

// --- Configuration -----------------------------------------------------------
// One level above the web root (this script lives in the web root). Resolves to
// e.g. ~/todo-sync when the site is served from ~/yourdomain.tld. Override here
// if your layout differs — it must point somewhere OUTSIDE the web root.
define('STATE_DIR', dirname(__DIR__) . '/todo-sync');
define('STATE_FILE', STATE_DIR . '/state.json');
define('MAX_BYTES', 5 * 1024 * 1024); // 5 MB hard cap on a stored blob

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
    if (is_file(STATE_FILE)) {
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        header('X-Robots-Tag: noindex, nofollow');
        if ($method !== 'HEAD') {
            readfile(STATE_FILE);
        }
        exit;
    }
    // Nothing stored yet — a valid empty state the client understands.
    send_json(200, '{"updatedAt":0}');
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

    if (!is_dir(STATE_DIR)) {
        if (!@mkdir(STATE_DIR, 0700, true) && !is_dir(STATE_DIR)) {
            send_json(500, array('ok' => false, 'error' => 'cannot create storage dir'));
        }
    }

    // Atomic write: temp file in the same dir, then rename over the target so a
    // concurrent reader never sees a half-written file.
    $tmp = STATE_FILE . '.' . getmypid() . '.tmp';
    if (file_put_contents($tmp, $raw, LOCK_EX) === false || !@rename($tmp, STATE_FILE)) {
        @unlink($tmp);
        send_json(500, array('ok' => false, 'error' => 'write failed'));
    }
    @chmod(STATE_FILE, 0600);

    $updatedAt = isset($data['updatedAt']) ? $data['updatedAt'] : 0;
    send_json(200, array('ok' => true, 'updatedAt' => $updatedAt));
}

header('Allow: GET, PUT, POST');
send_json(405, array('ok' => false, 'error' => 'method not allowed'));
