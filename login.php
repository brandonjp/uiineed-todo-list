<?php
/**
 * login.php — HTML login form + handler for the Uiineed Todo List.
 *
 * A normal password-manager-autofillable form that replaces the old HTTP Basic
 * Auth dialog. On a correct passphrase it sets the signed session cookie (see
 * auth.php) and redirects to the app. Contains NO secrets — the bcrypt hash it
 * checks against lives in the outside-web-root config auth.php loads.
 *
 * The username field exists only so iOS/desktop password managers reliably save
 * and autofill the credential; its value is ignored — only the passphrase is
 * verified. This is a single-secret login.
 */
require __DIR__ . '/auth.php';

// Already logged in? Skip the form.
if (todo_is_authed()) {
    http_response_code(302);
    header('Location: index.php');
    exit;
}

$error = '';
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    $cfg      = todo_auth_config();
    $password = isset($_POST['password']) ? (string) $_POST['password'] : '';
    $remember = !empty($_POST['remember']);

    if (!empty($cfg['password_hash']) && password_verify($password, $cfg['password_hash'])) {
        todo_set_cookie($remember);
        http_response_code(302);
        header('Location: index.php');
        exit;
    }

    // Wrong (or unconfigured): constant-ish delay to blunt brute force, then
    // re-show the form. No lockout — avoids locking the real owner out.
    sleep(2);
    $error = 'Incorrect passphrase.';
}
?><!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="robots" content="noindex, nofollow, noarchive, nosnippet, noimageindex">
    <meta name="theme-color" content="#f7f7f7">
    <title>todo.bpf.fyi — sign in</title>
    <link rel="shortcut icon" href="public/img/favicon.png">
    <style>
        * { box-sizing: border-box; }
        body {
            margin: 0; min-height: 100vh; display: flex; align-items: center;
            justify-content: center; background: #f2f3f5;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            color: #2b2b2b; padding: 24px;
        }
        .card {
            width: 100%; max-width: 340px; background: #fff; border-radius: 16px;
            padding: 32px 28px; box-shadow: 0 10px 40px rgba(0,0,0,.08);
        }
        h1 { font-size: 18px; margin: 0 0 4px; font-weight: 600; }
        p.sub { margin: 0 0 24px; font-size: 13px; color: #8a8a8a; }
        label { display: block; font-size: 12px; color: #8a8a8a; margin: 0 0 6px; }
        input[type=text], input[type=password] {
            width: 100%; padding: 12px 14px; margin: 0 0 16px; font-size: 16px;
            border: 1px solid #e0e0e0; border-radius: 10px; background: #fafafa;
            -webkit-appearance: none; appearance: none;
        }
        input:focus { outline: none; border-color: #b9b9b9; background: #fff; }
        .remember { display: flex; align-items: center; gap: 8px; margin: 0 0 20px; font-size: 13px; color: #555; }
        .remember input { width: 16px; height: 16px; margin: 0; }
        button {
            width: 100%; padding: 12px; font-size: 15px; font-weight: 600; color: #fff;
            background: #2b2b2b; border: none; border-radius: 10px; cursor: pointer;
        }
        button:active { opacity: .85; }
        .error { background: #fdecec; color: #c0392b; font-size: 13px; padding: 10px 12px; border-radius: 8px; margin: 0 0 18px; }
    </style>
</head>
<body>
    <form class="card" method="post" action="login.php" autocomplete="on">
        <h1>todo.bpf.fyi</h1>
        <p class="sub">Private todo list — please sign in.</p>
        <?php if ($error): ?><div class="error"><?php echo htmlspecialchars($error); ?></div><?php endif; ?>

        <!-- Username is ignored server-side; present only so password managers
             save/autofill this credential reliably. -->
        <label for="username">Name</label>
        <input type="text" id="username" name="username" value="todo"
               autocomplete="username" autocapitalize="none" autocorrect="off">

        <label for="password">Passphrase</label>
        <input type="password" id="password" name="password"
               autocomplete="current-password" autofocus required>

        <label class="remember">
            <input type="checkbox" name="remember" value="1" checked>
            Remember me on this device
        </label>

        <button type="submit">Sign in</button>
    </form>
</body>
</html>
