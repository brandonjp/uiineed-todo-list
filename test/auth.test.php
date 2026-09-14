<?php
/*
 * auth.test.php — zero-dependency tests for the API-token + site-name
 * helpers in auth.php. Run with:
 *
 *     php test/auth.test.php
 *
 * auth.php statically caches todo_auth_config() once per process, so the
 * simplest way to exercise several different config fixtures cleanly is one
 * PHP CLI subprocess per case, each pointed at its own throwaway config file
 * via the TODO_AUTH_CONFIG_PATH override (see the doc comment on
 * todo_auth_config() in auth.php — that override is test-only and unset in
 * every real deployment).
 */

$root = dirname(__DIR__);
$authPath = $root . '/auth.php';
$tmpDir = sys_get_temp_dir() . '/uiineed-todo-authtest-' . getmypid();
if (!is_dir($tmpDir)) mkdir($tmpDir, 0700, true);

$passed = 0;
$failed = 0;

/** Run $exprToEcho in a subprocess (auth.php already required, $_SERVER
 *  already populated from $serverOverrides) against $configArr, and assert
 *  its output equals $expected exactly. */
function run_case($name, $configArr, $serverOverrides, $exprToEcho, $expected) {
    global $tmpDir, $authPath, $passed, $failed;

    $slug = preg_replace('/[^a-z0-9]+/i', '-', $name);
    $cfgFile = $tmpDir . '/config-' . $slug . '.php';
    file_put_contents($cfgFile, '<?php return ' . var_export($configArr, true) . ';');

    $serverLines = '';
    foreach ($serverOverrides as $k => $v) {
        $serverLines .= '$_SERVER[' . var_export($k, true) . '] = ' . var_export($v, true) . ";\n";
    }

    $script = '<?php ' . $serverLines .
        'putenv(' . var_export('TODO_AUTH_CONFIG_PATH=' . $cfgFile, true) . ");\n" .
        'require ' . var_export($authPath, true) . ";\n" .
        'echo ' . $exprToEcho . ';';

    $scriptFile = $tmpDir . '/case-' . $slug . '.php';
    file_put_contents($scriptFile, $script);

    $out = rtrim((string) shell_exec('php ' . escapeshellarg($scriptFile) . ' 2>&1'), "\n");

    if ($out === $expected) {
        $passed++;
        echo "  ok - $name\n";
    } else {
        $failed++;
        echo "  FAIL - $name: expected " . var_export($expected, true) . ", got " . var_export($out, true) . "\n";
    }
}

echo "auth.php token + site-name tests\n";

// ---- todo_api_identity() ---------------------------------------------------
$tokenCfg = array(
    'password_hash' => 'x',
    'signing_key'   => 'y',
    'api_tokens'    => array(
        'macbook-mcp' => hash('sha256', 'good-token-value'),
    ),
);

run_case(
    'todo_api_identity: good token returns its name',
    $tokenCfg,
    array('HTTP_AUTHORIZATION' => 'Bearer good-token-value'),
    'var_export(todo_api_identity(), true)',
    "'macbook-mcp'"
);

run_case(
    'todo_api_identity: wrong token returns null',
    $tokenCfg,
    array('HTTP_AUTHORIZATION' => 'Bearer wrong-token-value'),
    'var_export(todo_api_identity(), true)',
    'NULL'
);

run_case(
    'todo_api_identity: absent Authorization header returns null',
    $tokenCfg,
    array(),
    'var_export(todo_api_identity(), true)',
    'NULL'
);

run_case(
    'todo_api_identity: REDIRECT_HTTP_AUTHORIZATION fallback works',
    $tokenCfg,
    array('REDIRECT_HTTP_AUTHORIZATION' => 'Bearer good-token-value'),
    'var_export(todo_api_identity(), true)',
    "'macbook-mcp'"
);

run_case(
    'todo_api_identity: no api_tokens configured -> null even with a header',
    array('password_hash' => 'x', 'signing_key' => 'y'),
    array('HTTP_AUTHORIZATION' => 'Bearer anything'),
    'var_export(todo_api_identity(), true)',
    'NULL'
);

// ---- todo_site_name() -------------------------------------------------------
run_case(
    'todo_site_name: explicit site_name wins',
    array('site_name' => 'My Todos', 'password_hash' => 'x', 'signing_key' => 'y'),
    array('HTTP_HOST' => 'example.com'),
    'todo_site_name()',
    'My Todos'
);

run_case(
    'todo_site_name: falls back to a valid Host header',
    array('password_hash' => 'x', 'signing_key' => 'y'),
    array('HTTP_HOST' => 'todo.example.com'),
    'todo_site_name()',
    'todo.example.com'
);

run_case(
    'todo_site_name: rejects a Host header with disallowed characters',
    array('password_hash' => 'x', 'signing_key' => 'y'),
    array('HTTP_HOST' => 'evil.com/<script>'),
    'todo_site_name()',
    'Todo'
);

run_case(
    'todo_site_name: no config, no Host -> neutral fallback',
    array(),
    array(),
    'todo_site_name()',
    'Todo'
);

echo "\n" . ($failed === 0
    ? "All $passed tests passed.\n"
    : "$failed of " . ($passed + $failed) . " tests FAILED.\n");

array_map('unlink', glob($tmpDir . '/*'));
@rmdir($tmpDir);

exit($failed === 0 ? 0 : 1);
