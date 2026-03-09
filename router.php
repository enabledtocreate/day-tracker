<?php
/**
 * Router for PHP built-in server: /api/* -> api/*.php, / and /assets/* -> dist/, install.php at root.
 */
$uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);

if (preg_match('#^/api/(.+)$#', $uri, $m)) {
    $file = __DIR__ . '/api/' . $m[1];
    if (pathinfo($file, PATHINFO_EXTENSION) === 'php' && is_file($file)) {
        require $file;
        return true;
    }
}

$distFile = __DIR__ . '/dist' . $uri;
if ($uri !== '/' && $uri !== '' && is_file($distFile)) {
    $ext = pathinfo($distFile, PATHINFO_EXTENSION);
    $types = ['css' => 'text/css', 'js' => 'application/javascript', 'html' => 'text/html'];
    if (isset($types[$ext])) {
        header('Content-Type: ' . $types[$ext] . '; charset=utf-8');
    }
    echo file_get_contents($distFile);
    return true;
}

if ($uri === '/' || $uri === '') {
    $index = __DIR__ . '/dist/index.html';
    if (is_file($index)) {
        header('Content-Type: text/html; charset=utf-8');
        echo file_get_contents($index);
        return true;
    }
}

return false;
