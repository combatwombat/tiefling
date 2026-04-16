<?php

// One-off: migrate existing output/<hash>/<name>.ply → output/<hash>/splat.sog + meta.json
// Run from the site root:  php migrate.php

if (php_sapi_name() !== 'cli') {
    http_response_code(403);
    exit('CLI only');
}

$root = __DIR__;
$outputBase = "$root/output";
$splatTransform = "$root/node_modules/.bin/splat-transform";

if (!is_file($splatTransform)) {
    fwrite(STDERR, "splat-transform not found at $splatTransform\nRun: npm install\n");
    exit(1);
}

// Copy of extractPlyMeta from api.php — duplicated intentionally so this script is standalone.
function extractPlyMeta(string $plyPath): array {
    $fh = fopen($plyPath, 'rb');
    if (!$fh) return [];

    $typeSizes = [
        'char' => 1, 'uchar' => 1, 'int8' => 1, 'uint8' => 1,
        'short' => 2, 'ushort' => 2, 'int16' => 2, 'uint16' => 2,
        'int' => 4, 'uint' => 4, 'int32' => 4, 'uint32' => 4,
        'float' => 4, 'float32' => 4,
        'double' => 8, 'float64' => 8,
        'u1' => 1, 'u4' => 4, 'i4' => 4, 'f4' => 4, 'f8' => 8,
    ];

    $elements = [];
    $currentElement = null;
    while (($line = fgets($fh)) !== false) {
        $line = trim($line);
        if ($line === 'end_header') break;
        if (str_starts_with($line, 'element ')) {
            $parts = explode(' ', $line);
            $currentElement = $parts[1];
            $elements[$currentElement] = ['count' => (int)$parts[2], 'propBytes' => 0];
        } elseif (str_starts_with($line, 'property ') && $currentElement !== null) {
            $parts = explode(' ', $line);
            $type = $parts[1];
            if (isset($typeSizes[$type])) {
                $elements[$currentElement]['propBytes'] += $typeSizes[$type];
            }
        }
    }
    $dataStart = ftell($fh);

    $offset = $dataStart;
    $result = [];
    foreach ($elements as $name => $el) {
        $totalBytes = $el['count'] * $el['propBytes'];
        if ($name === 'intrinsic' && $el['count'] === 9 && $el['propBytes'] === 4) {
            fseek($fh, $offset);
            $raw = fread($fh, 9 * 4);
            $vals = array_values(unpack('f9', $raw));
            $result['f_px'] = $vals[0];
        } elseif ($name === 'image_size' && $el['count'] === 2 && $el['propBytes'] === 4) {
            fseek($fh, $offset);
            $raw = fread($fh, 2 * 4);
            $vals = array_values(unpack('V2', $raw));
            $result['img_width'] = $vals[0];
            $result['img_height'] = $vals[1];
        }
        $offset += $totalBytes;
    }

    fclose($fh);
    return $result;
}

$dirs = glob("$outputBase/*", GLOB_ONLYDIR);
$total = count($dirs);
$converted = 0;
$skipped = 0;
$failed = 0;

foreach ($dirs as $i => $dir) {
    $hash = basename($dir);
    $idx = sprintf("[%d/%d]", $i + 1, $total);

    $sogPath = "$dir/splat.sog";
    $metaPath = "$dir/meta.json";

    if (file_exists($sogPath)) {
        echo "$idx $hash  already migrated, skipping\n";
        $skipped++;
        continue;
    }

    $plyFiles = glob("$dir/*.ply");
    if (empty($plyFiles)) {
        echo "$idx $hash  no .ply found, skipping\n";
        $skipped++;
        continue;
    }

    $plyPath = $plyFiles[0];
    echo "$idx $hash  converting " . basename($plyPath) . "...\n";

    $meta = extractPlyMeta($plyPath);

    $cmd = escapeshellarg($splatTransform) . ' -w -q ' . escapeshellarg($plyPath) . ' ' . escapeshellarg($sogPath) . ' 2>&1';
    $out = [];
    $rc = 0;
    exec($cmd, $out, $rc);

    if ($rc !== 0 || !file_exists($sogPath)) {
        echo "    FAILED (code $rc): " . implode("\n    ", $out) . "\n";
        $failed++;
        continue;
    }

    file_put_contents($metaPath, json_encode($meta));
    @unlink($plyPath);

    $sogSize = filesize($sogPath);
    echo "    ok — splat.sog " . round($sogSize / 1024 / 1024, 1) . "M\n";
    $converted++;
}

echo "\nDone. Converted: $converted, skipped: $skipped, failed: $failed, total: $total\n";
