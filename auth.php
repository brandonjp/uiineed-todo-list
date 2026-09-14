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

/**
 * Load the secret config from OUTSIDE the web root (cached per request).
 *
 * TODO_AUTH_CONFIG_PATH is a server-set environment variable (never derived
 * from request input, so it is not attacker-reachable) that lets
 * test/auth.test.php point this at a throwaway fixture instead of the real
 * one-level-above-webroot path. Unset in every real deployment, where this
 * always resolves to the documented path.
 */
function todo_auth_config() {
    static $cfg = null;
    if ($cfg === null) {
        $path = getenv('TODO_AUTH_CONFIG_PATH');
        if ($path === false || $path === '') {
            $path = dirname(__DIR__) . '/todo-auth/config.php';
        }
        $cfg = is_file($path) ? require $path : array();
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

/**
 * Display name for this deployment. Never hardcoded — resolved per request.
 *
 * Order: an explicit `site_name` in the out-of-web-root config, else the
 * request's own Host header, else a neutral fallback.
 *
 * NOTE: HTTP_HOST is client-controlled. The return value is therefore for
 * DISPLAY ONLY and every caller MUST escape it. It is never used to build a
 * URL, a redirect target, or a cookie domain — all redirects in this codebase
 * are relative (`Location: index.php`). As defense in depth, a Host value
 * containing anything outside hostname characters is rejected outright rather
 * than trusted to escaping alone.
 */
function todo_site_name() {
    $cfg = todo_auth_config();
    if (!empty($cfg['site_name'])) return $cfg['site_name'];
    if (!empty($_SERVER['HTTP_HOST']) && preg_match('/^[A-Za-z0-9.:-]+$/', $_SERVER['HTTP_HOST'])) {
        return $_SERVER['HTTP_HOST'];
    }
    return 'Todo';
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

/** Extract the bearer token from the request, or '' if absent. */
function todo_bearer_token() {
    // Apache with PHP as CGI/FastCGI strips Authorization unless it is
    // explicitly passed through — see .htaccess.example for the required
    // RewriteRule / CGIPassAuth line.
    $hdr = '';
    if (!empty($_SERVER['HTTP_AUTHORIZATION'])) {
        $hdr = $_SERVER['HTTP_AUTHORIZATION'];
    } elseif (!empty($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) {
        $hdr = $_SERVER['REDIRECT_HTTP_AUTHORIZATION'];
    }
    if (stripos($hdr, 'Bearer ') !== 0) return '';
    return trim(substr($hdr, 7));
}

/**
 * True when the request declares a JSON body. Write endpoints require it as
 * CSRF defense in depth: a cross-origin page can send a body without a CORS
 * preflight only as text/plain, form-urlencoded, or multipart — never
 * application/json — and nothing here answers a preflight. The session cookie
 * alone doesn't prove a request came from the app, because SameSite=Lax still
 * sends it from any sibling subdomain (same *site*, different origin).
 */
function todo_is_json_request() {
    $type = '';
    if (!empty($_SERVER['CONTENT_TYPE'])) {
        $type = $_SERVER['CONTENT_TYPE'];
    } elseif (!empty($_SERVER['HTTP_CONTENT_TYPE'])) {
        $type = $_SERVER['HTTP_CONTENT_TYPE'];
    }
    return stripos(trim($type), 'application/json') === 0;
}

/**
 * Name of the API token presented in this request, or null if none matched
 * (including when no api_tokens are configured at all — token auth is
 * opt-in). Constant-time: every configured token is checked even after a
 * match, so response time cannot reveal how many tokens exist or where in
 * the list a hit landed.
 */
function todo_api_identity() {
    $cfg = todo_auth_config();
    if (empty($cfg['api_tokens']) || !is_array($cfg['api_tokens'])) return null;

    $token = todo_bearer_token();
    if ($token === '') return null;
    $presented = hash('sha256', $token);

    $found = null;
    foreach ($cfg['api_tokens'] as $name => $expected) {
        if (hash_equals((string) $expected, $presented)) $found = $name;
    }
    return $found;
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
