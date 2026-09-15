<?php
/**
 * store.php — shared, locked storage for the Uiineed Todo List's single JSON
 * state blob. sync.php (browser, whole-blob writes) and api.php (machine,
 * read-modify-write) both require this.
 *
 * SECRETS: none. STATE_DIR is a fixed server-side constant, never built from
 * request input, so there is no path-traversal vector. Safe to commit.
 */

define('STATE_DIR',  dirname(__DIR__) . '/todo-sync');
define('STATE_FILE', STATE_DIR . '/state.json');
define('LOCK_FILE',  STATE_DIR . '/state.lock');
define('MAX_BYTES',  5 * 1024 * 1024); // 5 MB hard cap on a stored blob

/** The shape the client understands when nothing has been stored yet. */
function todo_store_empty() {
    return array('updatedAt' => 0);
}

function todo_store_ensure_dir() {
    if (is_dir(STATE_DIR)) return true;
    return (@mkdir(STATE_DIR, 0700, true)) || is_dir(STATE_DIR);
}

/** Read the current blob without taking the write lock. Always returns an array. */
function todo_store_read() {
    if (!is_file(STATE_FILE)) return todo_store_empty();
    $raw = @file_get_contents(STATE_FILE);
    if ($raw === false || $raw === '') return todo_store_empty();
    $data = json_decode($raw, true);
    return (json_last_error() === JSON_ERROR_NONE && is_array($data)) ? $data : todo_store_empty();
}

/**
 * Run $fn under an exclusive lock, passing it the decoded current blob
 * (never null — todo_store_empty() if nothing is stored yet). Whatever $fn
 * returns is JSON-encoded and written back atomically (temp file + rename in
 * the same directory, so a concurrent reader never sees a half-written
 * file). Returns the array that was written.
 *
 * $fn may return NULL to abort the write and leave the stored blob untouched
 * — how sync.php declines a push whose base version no longer matches. The
 * decision has to happen in here, under the lock, or it would race the very
 * writer it is checking for. Returns null in that case.
 *
 * The lock's job is narrow: stop two overlapping read-modify-write calls
 * (e.g. two API writes issued back to back) from interleaving and losing one
 * of the two changes. It does NOT protect against a stale browser tab
 * pushing an older whole-blob snapshot after an API write — that is a
 * last-write-wins blob-timestamp race the client already owns via
 * planSync() in app.js. See the design doc's REVIEW-3 for the tradeoff.
 *
 * Throws RuntimeException on any failure; callers turn that into a 500.
 */
function todo_store_mutate($fn) {
    if (!todo_store_ensure_dir()) {
        throw new RuntimeException('cannot create storage dir');
    }
    $lock = fopen(LOCK_FILE, 'c');
    if ($lock === false || !flock($lock, LOCK_EX)) {
        if ($lock !== false) fclose($lock);
        throw new RuntimeException('cannot acquire storage lock');
    }
    try {
        $current = todo_store_read();
        $next = $fn($current);
        if ($next === null) {
            return null; // the callback declined to write
        }
        if (!is_array($next)) {
            throw new RuntimeException('mutation callback did not return an array');
        }
        // Unescaped so the stored file stays byte-close to what the browser
        // sent: default escaping turns each CJK character into a 6-byte
        // \uXXXX, which could push a body under the raw MAX_BYTES check over it.
        $json = json_encode($next, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($json === false) {
            throw new RuntimeException('failed to encode state');
        }
        if (strlen($json) > MAX_BYTES) {
            throw new RuntimeException('payload too large');
        }
        $tmp = STATE_FILE . '.' . getmypid() . '.tmp';
        if (file_put_contents($tmp, $json, LOCK_EX) === false || !@rename($tmp, STATE_FILE)) {
            @unlink($tmp);
            throw new RuntimeException('write failed');
        }
        @chmod(STATE_FILE, 0600);
        return $next;
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}
