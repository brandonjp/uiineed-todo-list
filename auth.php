<?php
/**
 * auth.php — shared cookie-session auth guard for the Uiineed Todo List.
 *
 * Replaces the old Apache HTTP Basic Auth gate. A normal HTML login form
 * (login.php) sets an HMAC-signed cookie; this file verifies it and gates the
 * app front door (index.php / index-zh.php) and the data endpoint (sync.php).
 *
 * SECRETS LIVE OUTSIDE THE WEB ROOT — this file contains none, so it is safe to
 * commit to the public repo. It reads:
 *
 *     <one level above web root>/todo-auth/config.php
 *       <?php return array(
 *         'password_hash' => '$2y$...',   // bcrypt hash of the passphrase
 *         'signing_key'   => '<random hex>',
 *       );
 *
 * The cookie is  base64(expiry) . "." . HMAC_SHA256(expiry . "|" . password_hash, signing_key)
 * Binding the signature to password_hash means changing the password (or the
 * signing key) instantly invalidates every existing session on every device.
 */

define('TODO_AUTH_COOKIE', 'todo_auth');
define('TODO_AUTH_REMEMBER_SECONDS', 365 * 24 * 60 * 60); // 1 year

/** Load the secret config from OUTSIDE the web root (cached per request). */
function todo_auth_config() {
    static $cfg = null;
    if ($cfg === null) {
        $path = dirname(__DIR__) . '/todo-auth/config.php';
        $cfg  = is_file($path) ? require $path : array();
    }
    return $cfg;
}

/** HMAC that binds the cookie to both the signing key AND the password hash. */
function todo_auth_sign($expiry, $cfg) {
    $material = $expiry . '|' . (isset($cfg['password_hash']) ? $cfg['password_hash'] : '');
    return hash_hmac('sha256', $material, $cfg['signing_key']);
}

/** True when the request carries a valid, unexpired, untampered cookie. */
function todo_is_authed() {
    $cfg = todo_auth_config();
    if (empty($cfg['signing_key']) || empty($cfg['password_hash'])) return false;
    if (empty($_COOKIE[TODO_AUTH_COOKIE])) return false;

    $parts = explode('.', $_COOKIE[TODO_AUTH_COOKIE], 2);
    if (count($parts) !== 2) return false;
    list($payload, $sig) = $parts;

    $expected = todo_auth_sign($payload, $cfg);
    if (!hash_equals($expected, $sig)) return false;

    // payload is base64 of the absolute expiry epoch (0 = session cookie, no
    // server-side expiry — the browser drops it when the session ends).
    $expiry = (int) base64_decode($payload, true);
    if ($expiry !== 0 && $expiry < time()) return false;

    return true;
}

/** Issue a fresh signed cookie. $remember=true → 1-year persistent; else session. */
function todo_set_cookie($remember) {
    $cfg     = todo_auth_config();
    $expiry  = $remember ? time() + TODO_AUTH_REMEMBER_SECONDS : 0;
    $payload = base64_encode((string) $expiry);
    $value   = $payload . '.' . todo_auth_sign($payload, $cfg);

    setcookie(TODO_AUTH_COOKIE, $value, array(
        'expires'  => $remember ? $expiry : 0, // 0 = session cookie
        'path'     => '/',
        'secure'   => true,
        'httponly' => true,
        'samesite' => 'Lax',
    ));
}

/** Clear the auth cookie (logout). */
function todo_clear_cookie() {
    setcookie(TODO_AUTH_COOKIE, '', array(
        'expires'  => time() - 3600,
        'path'     => '/',
        'secure'   => true,
        'httponly' => true,
        'samesite' => 'Lax',
    ));
}

/**
 * Gate the current request. Authed → return and let the page render.
 * Not authed → redirect a browser to login.php, or send 401 JSON to the API.
 */
function todo_require_auth() {
    if (todo_is_authed()) return;

    $script = isset($_SERVER['SCRIPT_NAME']) ? basename($_SERVER['SCRIPT_NAME']) : '';
    if ($script === 'sync.php') {
        http_response_code(401);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        echo '{"ok":false,"error":"unauthorized"}';
        exit;
    }

    http_response_code(302);
    header('Location: login.php');
    exit;
}
