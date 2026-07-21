<?php
/**
 * logout.php — clear the auth cookie and return to the login form.
 * Use for a shared/temp device where you signed in with "Remember me".
 */
require __DIR__ . '/auth.php';
todo_clear_cookie();
http_response_code(302);
header('Location: login.php');
