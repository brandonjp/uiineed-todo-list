<?php
/**
 * api.php — token-authenticated machine API for the Uiineed Todo List.
 *
 * Separate from sync.php on purpose: sync.php is the browser's whole-blob
 * channel and keeps its cookie-only posture unchanged; this is the machine
 * channel, with different auth and a different (per-task) shape. Both share
 * storage via store.php, so a change made here shows up in the browser and
 * vice versa — same STATE_FILE, same `updatedAt` last-write-wins contract
 * the client's planSync() already implements.
 *
 *   GET    ?resource=tasks              -> {"ok":true,"tasks":[…],"updatedAt":N}
 *   POST   ?resource=tasks              body {"title":"…"}   -> creates, returns the new task
 *   PATCH  ?resource=tasks&id=<id>      body {"completed":true} and/or {"title":"…"}
 *   DELETE ?resource=tasks&id=<id>      -> moves the task to the recycle bin
 *   anything else                       -> 405 with an Allow header
 *
 * SECURITY / DESIGN NOTES
 * - Auth: a valid bearer token (todo_api_identity()) OR a valid browser
 *   session cookie (todo_is_authed()) — the cookie path exists so this
 *   endpoint can be exercised from a logged-in browser tab while debugging.
 *   See auth.php for token verification.
 * - Same-origin posture carried over from sync.php: no CORS headers, ever.
 * - "tasks" means the `todos` array only — the recycle bin is not exposed
 *   through this API; DELETE moves a task there but does not expose restore.
 * - Routing uses query parameters, not path segments: PATH_INFO handling
 *   varies across shared-hosting PHP handlers, query params need no Apache
 *   rewrite config.
 */

require __DIR__ . '/auth.php';
require __DIR__ . '/store.php';

function todo_api_send($status, $payload) {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Robots-Tag: noindex, nofollow');
    echo json_encode($payload);
    exit;
}

// --- Auth gate (must be first) -----------------------------------------------
if (todo_api_identity() === null && !todo_is_authed()) {
    todo_api_send(401, array('ok' => false, 'error' => 'unauthorized'));
}

/** Mint an id in the exact format public/js/app.js genId() produces:
 *  't' + base36(ms) + '-' + base36(counter). */
function todo_gen_id($ms, $counter) {
    return 't' . base_convert((string) $ms, 10, 36) . '-' . base_convert((string) $counter, 10, 36);
}

/** Decode the JSON request body as an associative array, or null if it isn't
 *  one (missing body, invalid JSON, or a non-object top level). */
function todo_api_body() {
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') return array();
    if (strlen($raw) > MAX_BYTES) return null;
    $data = json_decode($raw, true);
    if (json_last_error() !== JSON_ERROR_NONE || !is_array($data)) return null;
    return $data;
}

$resource = isset($_GET['resource']) ? $_GET['resource'] : '';
$method   = isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : 'GET';

if ($resource !== 'tasks') {
    todo_api_send(404, array('ok' => false, 'error' => 'unknown resource'));
}

if ($method === 'GET') {
    $state = todo_store_read();
    $tasks = isset($state['todos']) && is_array($state['todos']) ? $state['todos'] : array();
    $updatedAt = isset($state['updatedAt']) ? $state['updatedAt'] : 0;
    todo_api_send(200, array('ok' => true, 'tasks' => array_values($tasks), 'updatedAt' => $updatedAt));
}

if ($method === 'POST') {
    $body = todo_api_body();
    if ($body === null) {
        todo_api_send(400, array('ok' => false, 'error' => 'invalid JSON object'));
    }
    $title = isset($body['title']) ? (string) $body['title'] : '';
    if ($title === '') {
        todo_api_send(400, array('ok' => false, 'error' => 'title is required'));
    }

    $newTask = null;
    try {
        $next = todo_store_mutate(function ($current) use ($title, &$newTask) {
            $ms = (int) round(microtime(true) * 1000);
            $newTask = array(
                'id'        => todo_gen_id($ms, 0),
                'title'     => $title,
                'completed' => false,
                'removed'   => false,
                'createdAt' => $ms,
            );
            $todos = isset($current['todos']) && is_array($current['todos']) ? $current['todos'] : array();
            array_unshift($todos, $newTask); // newest-first, matching app.js addTodo()
            $current['todos'] = $todos;
            if (!isset($current['recycleBin']) || !is_array($current['recycleBin'])) {
                $current['recycleBin'] = array();
            }
            $current['updatedAt'] = $ms;
            return $current;
        });
    } catch (RuntimeException $e) {
        todo_api_send(500, array('ok' => false, 'error' => 'write failed'));
    }

    todo_api_send(200, array('ok' => true, 'task' => $newTask, 'updatedAt' => $next['updatedAt']));
}

if ($method === 'PATCH') {
    $id = isset($_GET['id']) ? (string) $_GET['id'] : '';
    if ($id === '') {
        todo_api_send(400, array('ok' => false, 'error' => 'id is required'));
    }
    $body = todo_api_body();
    if ($body === null) {
        todo_api_send(400, array('ok' => false, 'error' => 'invalid JSON object'));
    }
    if (!array_key_exists('completed', $body) && !array_key_exists('title', $body)) {
        todo_api_send(400, array('ok' => false, 'error' => 'nothing to update'));
    }

    $updated = null;
    try {
        $next = todo_store_mutate(function ($current) use ($id, $body, &$updated) {
            $todos = isset($current['todos']) && is_array($current['todos']) ? $current['todos'] : array();
            foreach ($todos as $i => $t) {
                if (!isset($t['id']) || (string) $t['id'] !== $id) continue;
                if (array_key_exists('completed', $body)) $t['completed'] = !!$body['completed'];
                if (array_key_exists('title', $body)) $t['title'] = (string) $body['title'];
                $todos[$i] = $t;
                $updated = $t;
                break;
            }
            $current['todos'] = $todos;
            if ($updated !== null) $current['updatedAt'] = (int) round(microtime(true) * 1000);
            return $current;
        });
    } catch (RuntimeException $e) {
        todo_api_send(500, array('ok' => false, 'error' => 'write failed'));
    }

    if ($updated === null) {
        todo_api_send(404, array('ok' => false, 'error' => 'task not found'));
    }
    todo_api_send(200, array('ok' => true, 'task' => $updated, 'updatedAt' => $next['updatedAt']));
}

if ($method === 'DELETE') {
    $id = isset($_GET['id']) ? (string) $_GET['id'] : '';
    if ($id === '') {
        todo_api_send(400, array('ok' => false, 'error' => 'id is required'));
    }

    $removed = null;
    try {
        $next = todo_store_mutate(function ($current) use ($id, &$removed) {
            $todos = isset($current['todos']) && is_array($current['todos']) ? $current['todos'] : array();
            $keep = array();
            foreach ($todos as $t) {
                if ($removed === null && isset($t['id']) && (string) $t['id'] === $id) {
                    $t['removed'] = true;
                    $removed = $t;
                    continue;
                }
                $keep[] = $t;
            }
            $current['todos'] = $keep;
            if ($removed !== null) {
                $bin = isset($current['recycleBin']) && is_array($current['recycleBin']) ? $current['recycleBin'] : array();
                array_unshift($bin, $removed);
                $current['recycleBin'] = $bin;
                $current['updatedAt'] = (int) round(microtime(true) * 1000);
            }
            return $current;
        });
    } catch (RuntimeException $e) {
        todo_api_send(500, array('ok' => false, 'error' => 'write failed'));
    }

    if ($removed === null) {
        todo_api_send(404, array('ok' => false, 'error' => 'task not found'));
    }
    todo_api_send(200, array('ok' => true, 'task' => $removed, 'updatedAt' => $next['updatedAt']));
}

header('Allow: GET, POST, PATCH, DELETE');
todo_api_send(405, array('ok' => false, 'error' => 'method not allowed'));
