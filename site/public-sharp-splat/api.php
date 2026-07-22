<?php

// Tiefling Sharp — api.php
// Receives an image (upload or URL), runs SHARP to generate a gaussian splat .ply, returns its path.

header('Content-Type: application/json');

$allowedOrigin = 'https://tiefling-sharp-splat.loc';
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin === $allowedOrigin) {
    header("Access-Control-Allow-Origin: $allowedOrigin");
    header("Access-Control-Allow-Methods: POST");
    header("Access-Control-Allow-Headers: Content-Type");
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    echo json_encode(['state' => 'error', 'data' => 'POST required']);
    exit;
}

// SHARP CLI. Note: the `sharp` binary uses Homebrew's Python 3.11, not the conda env —
// `conda run -n sharp` only set PATH and fell through to this same binary, so we call it directly.
$sharpBin = '/opt/homebrew/bin/sharp';

// Extract focal length and image size from a SHARP PLY file by parsing the binary format
function extractPlyMeta(string $plyPath): array {
    $fh = fopen($plyPath, 'rb');
    if (!$fh) return [];

    // Property type sizes in bytes
    $typeSizes = [
        'char' => 1, 'uchar' => 1, 'int8' => 1, 'uint8' => 1,
        'short' => 2, 'ushort' => 2, 'int16' => 2, 'uint16' => 2,
        'int' => 4, 'uint' => 4, 'int32' => 4, 'uint32' => 4,
        'float' => 4, 'float32' => 4,
        'double' => 8, 'float64' => 8,
        'u1' => 1, 'u4' => 4, 'i4' => 4, 'f4' => 4, 'f8' => 8,
    ];

    // Parse header: collect element names, counts, and per-element byte sizes
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

    // Walk through elements to find byte offsets for intrinsic and image_size
    $offset = $dataStart;
    $result = [];
    foreach ($elements as $name => $el) {
        $totalBytes = $el['count'] * $el['propBytes'];
        if ($name === 'intrinsic' && $el['count'] === 9 && $el['propBytes'] === 4) {
            fseek($fh, $offset);
            $raw = fread($fh, 9 * 4);
            $vals = array_values(unpack('f9', $raw));
            // intrinsic is a 3x3 matrix: [[fx,0,cx],[0,fy,cy],[0,0,1]]
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
$outputBase = __DIR__ . '/output';
$tmpBase = __DIR__ . '/tmp';

@mkdir($outputBase, 0755, true);
@mkdir($tmpBase, 0755, true);

// Get image — either file upload or URL
$imagePath = null;
$cleanup = false;

if (isset($_FILES['image']) && $_FILES['image']['error'] === UPLOAD_ERR_OK) {
    // File upload
    $ext = strtolower(pathinfo($_FILES['image']['name'], PATHINFO_EXTENSION));
    if (!in_array($ext, ['jpg', 'jpeg', 'png', 'webp'])) {
        echo json_encode(['state' => 'error', 'data' => 'Unsupported image format']);
        exit;
    }
    $id = bin2hex(random_bytes(8));
    $imagePath = "$tmpBase/$id.$ext";
    move_uploaded_file($_FILES['image']['tmp_name'], $imagePath);
    $cleanup = true;
} elseif (isset($_POST['imageUrl']) && $_POST['imageUrl'] !== '') {
    // URL — download it
    $url = str_replace(' ', '%20', trim($_POST['imageUrl']));
    $id = bin2hex(random_bytes(8));

    $ch = curl_init($url);
    $tmpFile = "$tmpBase/$id.jpg";
    $fp = fopen($tmpFile, 'w');
    curl_setopt_array($ch, [
        CURLOPT_FILE => $fp,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT => 30,
        CURLOPT_MAXFILESIZE => 50 * 1024 * 1024,
        CURLOPT_HTTPHEADER => ['User-Agent: Mozilla/5.0 (compatible; Tiefling/1.0)'],
        CURLOPT_SSL_VERIFYPEER => false, // allow self-signed certs (local dev)
        CURLOPT_SSL_VERIFYHOST => false,
    ]);
    $ok = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);
    fclose($fp);

    if (!$ok || $httpCode !== 200) {
        @unlink($tmpFile);
        $detail = $curlError ? " ($curlError)" : "";
        echo json_encode(['state' => 'error', 'data' => "Failed to fetch image (HTTP $httpCode)$detail"]);
        exit;
    }

    $imagePath = $tmpFile;
    $cleanup = true;
} else {
    echo json_encode(['state' => 'error', 'data' => 'No image provided']);
    exit;
}

// Hash the image for caching
$hash = md5_file($imagePath);
$outputDir = "$outputBase/$hash";
$sogPath = "$outputDir/splat.sog";
$metaPath = "$outputDir/meta.json";

// Force regeneration — delete cached output if requested
$force = isset($_POST['force']) && $_POST['force'];
if ($force && is_dir($outputDir)) {
    array_map('unlink', glob("$outputDir/*"));
}

// Check cache — if .sog already exists for this hash, return it
if (file_exists($sogPath)) {
    if ($cleanup) @unlink($imagePath);
    $meta = file_exists($metaPath) ? (json_decode(file_get_contents($metaPath), true) ?: []) : [];
    echo json_encode(['state' => 'success', 'input' => "output/$hash/splat.sog", 'hash' => $hash, 'cached' => true] + $meta);
    exit;
}

// Stage SHARP output in tmp — we only keep the final .sog in the output dir
$stagingDir = "$tmpBase/sharp_$hash";
@mkdir($stagingDir, 0755, true);

// Run SHARP
$escapedInput = escapeshellarg($imagePath);
$escapedStaging = escapeshellarg($stagingDir);
$cmd = escapeshellarg($sharpBin) . " predict -i $escapedInput -o $escapedStaging --no-render 2>&1";

$output = [];
$returnCode = 0;
exec($cmd, $output, $returnCode);
$outputStr = implode("\n", $output);

if ($cleanup) @unlink($imagePath);

if ($returnCode !== 0) {
    array_map('unlink', glob("$stagingDir/*"));
    @rmdir($stagingDir);
    echo json_encode(['state' => 'error', 'data' => "SHARP failed (code $returnCode): $outputStr"]);
    exit;
}

// Find the generated .ply
$plyFiles = glob("$stagingDir/*.ply");
if (empty($plyFiles)) {
    array_map('unlink', glob("$stagingDir/*"));
    @rmdir($stagingDir);
    echo json_encode(['state' => 'error', 'data' => "SHARP produced no .ply file. Output: $outputStr"]);
    exit;
}

$plyPath = $plyFiles[0];
$meta = extractPlyMeta($plyPath);

// Convert .ply → .sog
@mkdir($outputDir, 0755, true);
$splatTransform = __DIR__ . '/node_modules/.bin/splat-transform';
$convertCmd = escapeshellarg($splatTransform) . ' -w -q ' . escapeshellarg($plyPath) . ' ' . escapeshellarg($sogPath) . ' 2>&1';
$convertOutput = [];
$convertRc = 0;
exec($convertCmd, $convertOutput, $convertRc);

// Cleanup staging regardless of outcome
array_map('unlink', glob("$stagingDir/*"));
@rmdir($stagingDir);

if ($convertRc !== 0 || !file_exists($sogPath)) {
    echo json_encode(['state' => 'error', 'data' => "SOG conversion failed (code $convertRc): " . implode("\n", $convertOutput)]);
    exit;
}

file_put_contents($metaPath, json_encode($meta));

echo json_encode(['state' => 'success', 'input' => "output/$hash/splat.sog", 'hash' => $hash] + $meta);
