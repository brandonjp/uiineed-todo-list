#!/bin/bash
# api.e2e.sh — end-to-end checks for api.php, sync.php, and mcp/todo-mcp.mjs
# against a throwaway `php -S`. Zero dependencies beyond php, node, and curl:
#
#     bash test/api.e2e.sh          # PORT=9999 bash test/api.e2e.sh if 8765 is taken
#
# Copies the PHP files into a temp dir (so the one-level-up state and config
# paths resolve inside it, never beside the repo), mints a throwaway token,
# and always stops the server and deletes the temp dir on exit. Runs the
# server with several workers so the concurrency checks exercise the lock.
set -u
ROOT=$(cd "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d "${TMPDIR:-/tmp}/uiineed-api-e2e.XXXXXX")
mkdir -p "$TMP/web" "$TMP/todo-auth"
cp "$ROOT"/api.php "$ROOT"/auth.php "$ROOT"/store.php "$ROOT"/sync.php "$TMP/web/"

TOKEN=$(php -r 'echo bin2hex(random_bytes(32));')
HASH=$(php -r 'echo hash("sha256", $argv[1]);' "$TOKEN")
printf "<?php return array('password_hash' => 'e2e', 'signing_key' => 'e2e', 'api_tokens' => array('e2e' => '%s'));\n" "$HASH" > "$TMP/todo-auth/config.php"
COOKIE=$(php -r '$p = base64_encode("0"); echo $p . "." . hash_hmac("sha256", $p . "|e2e", "e2e");')

PORT=${PORT:-8765}
# Something already answering here would silently receive every request below.
if curl -s -o /dev/null "http://127.0.0.1:$PORT/"; then
    echo "port $PORT is already in use — rerun with PORT=<free port>" >&2
    rm -rf "$TMP"
    exit 1
fi
PHP_CLI_SERVER_WORKERS=8 php -S "127.0.0.1:$PORT" -t "$TMP/web" >"$TMP/server.log" 2>&1 &
SRV=$!
# With workers, php -S forks children that outlive a kill of the parent alone.
trap 'pkill -P $SRV 2>/dev/null; kill $SRV 2>/dev/null; wait $SRV 2>/dev/null; rm -rf "$TMP"' EXIT
for _ in $(seq 50); do
    curl -s -o /dev/null "http://127.0.0.1:$PORT/api.php" && break
    perl -e 'select(undef, undef, undef, 0.1)'
done

U="http://127.0.0.1:$PORT/api.php?resource=tasks"
SYNC="http://127.0.0.1:$PORT/sync.php"
A="Authorization: Bearer $TOKEN"
J="Content-Type: application/json"
PASS=0
FAIL=0

check() { # name expected actual
    if [ "$2" = "$3" ]; then PASS=$((PASS + 1)); echo "  ok - $1"
    else FAIL=$((FAIL + 1)); echo "  FAIL - $1: expected '$2', got '$3'"; fi
}
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
now_ms() { php -r 'echo (int) round(microtime(true) * 1000);'; }
# Print a dotted path (e.g. task.id, todos.0.id) out of the JSON on stdin.
jget() {
    php -r '$v = json_decode(stream_get_contents(STDIN), true);
        foreach (explode(".", $argv[1]) as $k) { $v = (is_array($v) && array_key_exists($k, $v)) ? $v[$k] : null; }
        echo is_bool($v) ? ($v ? "true" : "false") : (is_scalar($v) ? $v : json_encode($v));' "$1"
}

echo "api.php / sync.php / MCP end-to-end"

# ---- auth -------------------------------------------------------------------
check "no token -> 401" 401 "$(code "$U")"
check "wrong token -> 401" 401 "$(code -H 'Authorization: Bearer nope' "$U")"
check "good token -> 200" 200 "$(code -H "$A" "$U")"
check "session cookie -> 200" 200 "$(code -b "todo_auth=$COOKIE" "$U")"

# ---- input validation ---------------------------------------------------------
check "api.php text/plain body -> 415" 415 "$(code -X POST -H "$A" -H 'Content-Type: text/plain' -d '{"title":"x"}' "$U")"
check "sync.php text/plain body -> 415" 415 "$(code -X POST -b "todo_auth=$COOKIE" -H 'Content-Type: text/plain' -d '{"updatedAt":1}' "$SYNC")"
check "non-string title -> 400" 400 "$(code -X POST -H "$A" -H "$J" -d '{"title":["a"]}' "$U")"
check "blank title -> 400" 400 "$(code -X POST -H "$A" -H "$J" -d '{"title":"   "}' "$U")"

# ---- interop: an API write keeps the rest of a browser-pushed blob -----------
T0=$(now_ms)
check "sync.php JSON PUT -> 200" 200 "$(code -X PUT -b "todo_auth=$COOKIE" -H "$J" \
    -d "{\"version\":1,\"updatedAt\":$T0,\"slogan\":\"keep me\",\"todos\":[{\"id\":\"tbrowser-0\",\"title\":\"from browser\",\"completed\":false,\"removed\":false,\"createdAt\":$T0}],\"recycleBin\":[]}" "$SYNC")"
ID=$(curl -s -X POST -H "$A" -H "$J" -d '{"title":"from api"}' "$U" | jget task.id)
BLOB=$(curl -s -b "todo_auth=$COOKIE" "$SYNC")
check "API add keeps the browser's slogan" "keep me" "$(echo "$BLOB" | jget slogan)"
check "API add lands newest-first" "$ID" "$(echo "$BLOB" | jget todos.0.id)"
check "browser task still present" "tbrowser-0" "$(echo "$BLOB" | jget todos.1.id)"

# ---- PATCH / DELETE -------------------------------------------------------------
check "PATCH completed=true" true "$(curl -s -X PATCH -H "$A" -H "$J" -d '{"completed":true}' "$U&id=$ID" | jget task.completed)"
check "PATCH non-boolean completed -> 400" 400 "$(code -X PATCH -H "$A" -H "$J" -d '{"completed":"no"}' "$U&id=$ID")"
check "PATCH unknown id -> 404" 404 "$(code -X PATCH -H "$A" -H "$J" -d '{"completed":true}' "$U&id=nope")"
check "DELETE marks the task removed" true "$(curl -s -X DELETE -H "$A" "$U&id=$ID" | jget task.removed)"
check "deleted task is in recycleBin" "$ID" "$(curl -s -b "todo_auth=$COOKIE" "$SYNC" | jget recycleBin.0.id)"

# ---- updatedAt never goes backwards (browser clock ahead of the server) -------
AHEAD=$(( $(now_ms) + 60000 ))
curl -s -o /dev/null -X PUT -b "todo_auth=$COOKIE" -H "$J" -d "{\"version\":1,\"updatedAt\":$AHEAD,\"todos\":[],\"recycleBin\":[]}" "$SYNC"
AFTER=$(curl -s -X POST -H "$A" -H "$J" -d '{"title":"after skew"}' "$U" | jget updatedAt)
check "API write stamps above a future browser stamp" yes "$([ "${AFTER:-0}" -gt "$AHEAD" ] && echo yes || echo no)"

# ---- ids stay unique under concurrent writes ----------------------------------
pids=()
for i in $(seq 1 20); do
    curl -s -o /dev/null -X POST -H "$A" -H "$J" -d "{\"title\":\"burst $i\"}" "$U" & pids+=($!)
done
wait "${pids[@]}"
check "20 concurrent adds -> 21 tasks, 21 unique ids" "21 21" "$(curl -s -H "$A" "$U" | php -r '$ids = array_column(json_decode(stream_get_contents(STDIN), true)["tasks"], "id"); echo count($ids), " ", count(array_unique($ids));')"

# ---- MCP server over stdio ----------------------------------------------------
MCP=$(TODO_API_URL="http://127.0.0.1:$PORT/api.php" TODO_API_TOKEN="$TOKEN" MCP_SERVER="$ROOT/mcp/todo-mcp.mjs" \
    node --input-type=module <<'EOF'
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
const out = {};
setTimeout(() => { console.log(JSON.stringify(out)); process.exit(1); }, 15000).unref();
const child = spawn(process.execPath, [process.env.MCP_SERVER], { stdio: ['pipe', 'pipe', 'inherit'] });
const pending = new Map();
createInterface({ input: child.stdout }).on('line', (line) => {
    const msg = JSON.parse(line);
    if (pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
});
let nextId = 1;
const req = (method, params) => new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
});
const call = (name, args) => req('tools/call', { name, arguments: args });
out.protocol = (await req('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'e2e', version: '0' } })).result.protocolVersion;
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
out.tools = (await req('tools/list', {})).result.tools.map((t) => t.name).join(',');
out.ping = JSON.stringify((await req('ping', {})).result);
const adds = await Promise.all([...Array(8)].map((_, i) => call('add_task', { title: `mcp ${i}` })));
const ids = adds.map((r) => JSON.parse(r.result.content[0].text).id);
out.unique = `${ids.length} ${new Set(ids).size}`;
out.completed = JSON.parse((await call('complete_task', { id: ids[0] })).result.content[0].text).completed;
out.missingIsError = (await call('delete_task', { id: 'nope' })).result.isError === true;
const done = JSON.parse((await call('list_tasks', { filter: 'completed' })).result.content[0].text);
out.completedListed = done.some((t) => t.id === ids[0]);
console.log(JSON.stringify(out));
child.kill();
EOF
)
check "MCP initialize" "2024-11-05" "$(echo "$MCP" | jget protocol)"
check "MCP tools/list" "list_tasks,add_task,complete_task,delete_task" "$(echo "$MCP" | jget tools)"
check "MCP ping -> empty result" "{}" "$(echo "$MCP" | jget ping)"
check "MCP 8 parallel add_task -> 8 unique ids" "8 8" "$(echo "$MCP" | jget unique)"
check "MCP complete_task" true "$(echo "$MCP" | jget completed)"
check "MCP unknown id -> isError" true "$(echo "$MCP" | jget missingIsError)"
check "MCP list_tasks completed filter" true "$(echo "$MCP" | jget completedListed)"

# ---- nothing leaked into responses as PHP warnings ----------------------------
check "no PHP warnings/notices in the server log" 0 "$(grep -c 'PHP \(Warning\|Notice\|Deprecated\|Fatal\)' "$TMP/server.log")"

echo
if [ "$FAIL" -eq 0 ]; then echo "All $PASS tests passed."; else echo "$FAIL of $((PASS + FAIL)) tests FAILED."; fi
[ "$FAIL" -eq 0 ]
