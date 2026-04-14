<?php

$outputDir = __DIR__ . '/output';
$dirs = array_filter(glob($outputDir . '/*'), 'is_dir');

// Sort by modification time, newest first
usort($dirs, function($a, $b) {
    return filemtime($b) - filemtime($a);
});

$baseUrl = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
    ? 'https://' : 'http://';
$baseUrl .= $_SERVER['HTTP_HOST'] . rtrim(dirname($_SERVER['SCRIPT_NAME']), '/') . '/';

?><!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sharp Splat — Output Files</title>
<style>
body {
    font-family: sans-serif;
    background: #111;
    color: #ccc;
    padding: 1em;
    margin: 0;
}
h1 {
    font-size: 1.2em;
    margin: 0 0 0.5em;
}
.list {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
}
.list a {
    display: block;
    width: 550px;
    max-width: 100%;
    box-sizing: border-box;
    padding: 14px 18px;
    background: #222;
    color: #7af;
    text-decoration: none;
    border-radius: 8px;
    font-size: 1em;
    border: 1px solid #333;
}
.list a:visited {
    color: #a78;
    border-color: #443;
    background: #1a1a1a;
}
.list a:active {
    background: #335;
}
.meta {
    color: #888;
    font-size: 0.85em;
    margin-top: 4px;
}
</style>
</head>
<body>
<h1>Output .ply files (<?= count($dirs) ?>)</h1>
<div class="list">
<?php foreach ($dirs as $dir):
    $plys = glob($dir . '/*.ply');
    if (empty($plys)) continue;
    $ply = $plys[0];
    $relPath = 'output/' . basename($dir) . '/' . basename($ply);
    $mtime = filemtime($ply);
    $size = filesize($ply);
?>
<a href="<?= $baseUrl ?>?ply=<?= urlencode($relPath) ?>" target="_blank">
    <?= basename($dir) ?>/<?= basename($ply) ?>
    <div class="meta"><?= date('Y-m-d H:i', $mtime) ?> · <?= round($size / 1024) ?> KB</div>
</a>
<?php endforeach; ?>
</div>
</body>
</html>
