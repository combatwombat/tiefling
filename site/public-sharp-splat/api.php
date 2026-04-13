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

$condaRun = '/opt/homebrew/Caskroom/miniconda/base/bin/conda run --no-capture-output -n sharp';
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
$basename = pathinfo($imagePath, PATHINFO_FILENAME);

// Check cache — if .ply already exists for this hash, return it
$cachedPly = glob("$outputDir/*.ply");
if (!empty($cachedPly)) {
    if ($cleanup) @unlink($imagePath);
    $plyFile = basename($cachedPly[0]);
    echo json_encode(['state' => 'success', 'ply' => "output/$hash/$plyFile"]);
    exit;
}

@mkdir($outputDir, 0755, true);

// Run SHARP
$escapedInput = escapeshellarg($imagePath);
$escapedOutput = escapeshellarg($outputDir);
$cmd = "$condaRun sharp predict -i $escapedInput -o $escapedOutput --no-render 2>&1";

$output = [];
$returnCode = 0;
exec($cmd, $output, $returnCode);
$outputStr = implode("\n", $output);

if ($cleanup) @unlink($imagePath);

if ($returnCode !== 0) {
    echo json_encode(['state' => 'error', 'data' => "SHARP failed (code $returnCode): $outputStr"]);
    exit;
}

// Find the generated .ply
$plyFiles = glob("$outputDir/*.ply");
if (empty($plyFiles)) {
    echo json_encode(['state' => 'error', 'data' => "SHARP produced no .ply file. Output: $outputStr"]);
    exit;
}

$plyFile = basename($plyFiles[0]);
echo json_encode(['state' => 'success', 'ply' => "output/$hash/$plyFile"]);
