import * as THREE from "three";
import { SplatMesh, SparkRenderer, FpsMovement } from "@sparkjsdev/spark";

// --- State ---
const state = {
    camera: null,
    renderer: null,
    spark: null,
    scene: null,
    splatMesh: null,
    splatContainer: null, // group for coordinate transform
    // Camera control
    keys: {},
    mouseDown: false,
    euler: new THREE.Euler(0, 0, 0, "YXZ"),
    moveSpeed: 0.2,
    lookSpeed: 0.002,
    hudVisible: true,
    // Mouse parallax
    mouseNDC: { x: 0, y: 0 },        // normalized -1..1
    parallaxStrength: 0.05,            // how far camera strafes on mouse move
    parallaxTarget: new THREE.Vector3(),
    parallaxCurrent: new THREE.Vector3(),
    parallaxLerp: 0.05,              // smoothing per frame
    // Orbit pivot distance: 0 = rotate in place, large = orbit around distant point (≈ strafe)
    orbitDistance: 2,
    // Camera home position (where the original photo was taken)
    cameraHome: new THREE.Vector3(0, 0, 0),
    // Current image source for regeneration
    currentFile: null,
    currentUrl: null,
    currentHash: null,
    // WebXR / VR
    xrSession: null,
    cameraRig: null,            // Group that holds the camera — we move this for locomotion
    xrControllers: [],
    xrResetHeld: 0,             // seconds the reset button has been held
    xrResetThreshold: 1.0,      // seconds to hold before reset triggers
    xrResetDone: false,         // prevent repeated resets while holding
};

// --- Init Three.js ---
function initRenderer() {
    const container = document.getElementById("canvas-container");

    state.renderer = new THREE.WebGLRenderer({ antialias: false });
    state.renderer.setPixelRatio(window.devicePixelRatio);
    state.renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(state.renderer.domElement);

    state.scene = new THREE.Scene();

    state.camera = new THREE.PerspectiveCamera(
        60,
        window.innerWidth / window.innerHeight,
        0.01,
        1000
    );
    state.camera.position.set(0, 0, 0);

    // Camera rig: parent of camera. In VR, we move the rig for locomotion
    // while the headset controls camera's local transform (head tracking).
    // On desktop the rig stays at origin and we move the camera directly.
    state.cameraRig = new THREE.Group();
    state.cameraRig.add(state.camera);
    state.scene.add(state.cameraRig);

    // Enable WebXR
    state.renderer.xr.enabled = true;

    // Container for splat meshes — applies coordinate transform
    // SHARP uses OpenCV convention: x right, y down, z forward
    // Three.js uses: x right, y up, z toward viewer
    // Transform: rotate 180° around X axis (flips Y and Z)
    state.splatContainer = new THREE.Group();
    state.splatContainer.rotation.x = Math.PI;
    state.scene.add(state.splatContainer);

    // Spark renderer for gaussian splats
    state.spark = new SparkRenderer({ renderer: state.renderer });
    state.scene.add(state.spark);

    window.addEventListener("resize", onResize);
}

function onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    state.camera.aspect = w / h;
    state.camera.updateProjectionMatrix();
    state.renderer.setSize(w, h);
}

// --- Set camera FOV from SHARP metadata ---
function setCameraFromMeta(meta) {
    if (meta && meta.f_px && meta.img_height) {
        const fovY = 2 * Math.atan(meta.img_height / (2 * meta.f_px)) * (180 / Math.PI);
        console.log(`Setting camera FOV to ${fovY.toFixed(1)}° (f_px=${meta.f_px}, img=${meta.img_width}x${meta.img_height})`);
        state.camera.fov = fovY;
        state.camera.updateProjectionMatrix();
    }
}

// --- Splat loaded callback ---
function onSplatLoaded(mesh) {
    console.log("Splat loaded. Splat count:", mesh.numSplats);

    const box = mesh.getBoundingBox();
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);
    console.log("Splat bounds center:", center, "size:", size);

    // SHARP places the camera at the origin looking down +Z (OpenCV).
    // After our container's 180° X rotation, that becomes looking down -Z in Three.js,
    // which is exactly the default Three.js camera direction.
    // So: camera at origin, no rotation needed.
    state.cameraHome.set(0, 0, 0);
    state.camera.position.copy(state.cameraHome);
    state.euler.set(0, 0, 0);
    state.camera.quaternion.setFromEuler(state.euler);
    state.parallaxCurrent.set(0, 0, 0);
    state.parallaxTarget.set(0, 0, 0);
    // Reset VR rig too
    if (state.cameraRig) {
        state.cameraRig.position.set(0, 0, 0);
        state.cameraRig.quaternion.identity();
    }
}

// --- Load splat from .ply URL ---
function loadSplat(plyUrl) {
    if (state.splatMesh) {
        state.splatContainer.remove(state.splatMesh);
        state.splatMesh.dispose();
        state.splatMesh = null;
    }

    console.log("Loading splat:", plyUrl);

    state.splatMesh = new SplatMesh({
        url: plyUrl,
        onLoad: onSplatLoaded,
    });

    state.splatContainer.add(state.splatMesh);
}

// --- Image upload → API → .ply ---
async function processImage(file, force = false) {
    showLoading("Uploading image…");

    const formData = new FormData();
    formData.append("image", file);
    if (force) formData.append("force", "1");

    try {
        const est = Math.round(getEstimatedSeconds());
        showLoading(`Generating 3D gaussian splat… (~${est}s)`);
        startProgress();
        const resp = await fetch("api.php", {
            method: "POST",
            body: formData,
        });

        if (!resp.ok) throw new Error(`Server error: ${resp.status}`);

        const data = await resp.json();
        if (data.state === "error") throw new Error(data.data);

        progressWasGenerated = !data.cached;
        hideLoading();
        hideDropzone();

        state.currentFile = file;
        state.currentUrl = null;
        state.currentHash = data.hash || null;
        setCameraFromMeta(data);
        loadSplat(data.input);
        showRegenButton();
    } catch (err) {
        console.error("Processing failed:", err);
        hideLoading();
        showLoading("Error: " + err.message);
        setTimeout(hideLoading, 3000);
    }
}

async function processImageFromUrl(imageUrl, force = false) {
    showLoading("Fetching image…");

    try {
        const formData = new FormData();
        formData.append("imageUrl", imageUrl);
        if (force) formData.append("force", "1");

        const est = Math.round(getEstimatedSeconds());
        showLoading(`Generating 3D gaussian splat… (~${est}s)`);
        startProgress();
        const resp = await fetch("api.php", {
            method: "POST",
            body: formData,
        });

        if (!resp.ok) throw new Error(`Server error: ${resp.status}`);

        const data = await resp.json();
        if (data.state === "error") throw new Error(data.data);

        progressWasGenerated = !data.cached;
        hideLoading();
        hideDropzone();

        state.currentFile = null;
        state.currentUrl = imageUrl;
        state.currentHash = data.hash || null;
        setCameraFromMeta(data);
        loadSplat(data.input);
        showRegenButton();
    } catch (err) {
        console.error("Processing failed:", err);
        hideLoading();
        showLoading("Error: " + err.message);
        setTimeout(hideLoading, 3000);
    }
}

// --- UI helpers ---
const defaultTitle = document.title;
let progressInterval = null;
let progressStartTime = 0;
let progressWasGenerated = false;

function getEstimatedSeconds() {
    const stored = localStorage.getItem("splat-generation-seconds");
    return stored ? parseFloat(stored) : 30;
}

function showLoading(msg) {
    const el = document.getElementById("loading");
    el.classList.add("visible");
    el.querySelector(".message").textContent = msg || "Processing…";
    document.title = "🔴 " + (msg || "Processing…");
}

function startProgress() {
    const wrap = document.querySelector("#loading .progress-wrap");
    const fill = document.querySelector("#loading .progress-bar-fill");
    const timeEl = document.querySelector("#loading .progress-time");
    const estimate = getEstimatedSeconds() + 1;

    fill.style.transition = "none";
    fill.style.width = "0%";
    // force reflow so the reset takes effect before we animate
    fill.offsetWidth;
    fill.style.transition = "width 0.5s linear";

    wrap.classList.add("visible");
    progressStartTime = performance.now();

    function tick() {
        const elapsed = (performance.now() - progressStartTime) / 1000;
        const remaining = Math.max(0, estimate - elapsed);
        const pct = Math.min((elapsed / estimate) * 100, 100);
        fill.style.width = pct + "%";
        timeEl.textContent = remaining > 0
            ? `${Math.ceil(remaining)}s remaining`
            : "almost done…";
    }

    tick();
    progressInterval = setInterval(tick, 500);
}

function stopProgress() {
    if (progressInterval) {
        clearInterval(progressInterval);
        progressInterval = null;
    }
    document.querySelector("#loading .progress-wrap").classList.remove("visible");

    // Save actual elapsed time for next estimate (only for non-cached results)
    if (progressStartTime > 0) {
        const elapsed = (performance.now() - progressStartTime) / 1000;
        if (progressWasGenerated) {
            localStorage.setItem("splat-generation-seconds", elapsed.toFixed(1));
            console.log(`Splat generation took ${elapsed.toFixed(1)}s (saved for next estimate)`);
        } else {
            console.log(`Splat loaded from cache in ${elapsed.toFixed(1)}s (not saving)`);
        }
        progressStartTime = 0;
        progressWasGenerated = false;
    }
}

function hideLoading() {
    stopProgress();
    document.getElementById("loading").classList.remove("visible");
    document.title = defaultTitle;
}

function hideDropzone() {
    document.getElementById("dropzone").classList.add("hidden");
}

function showDropzone() {
    document.getElementById("dropzone").classList.remove("hidden");
}

function showRegenButton() {
    document.getElementById("regen-button").classList.remove("hidden");
}

async function regenerateCache() {
    if (state.currentFile) {
        processImage(state.currentFile, true);
    } else if (state.currentUrl) {
        processImageFromUrl(state.currentUrl, true);
    }
}

// --- Drag & drop ---
function initDragDrop() {
    const dropzone = document.getElementById("dropzone");
    const dropArea = document.getElementById("drop-area");
    const fileInput = document.getElementById("file-input");

    // Prevent default drag behaviors on window
    ["dragenter", "dragover", "dragleave", "drop"].forEach((evt) => {
        window.addEventListener(evt, (e) => {
            e.preventDefault();
            e.stopPropagation();
        });
    });

    // Highlight on drag over
    window.addEventListener("dragenter", () => {
        // Show dropzone if hidden (allow dropping new image anytime)
        if (dropzone.classList.contains("hidden")) {
            dropzone.classList.remove("hidden");
        }
        dropzone.classList.add("drag-over");
        dropArea.classList.add("drag-over");
    });

    dropzone.addEventListener("dragleave", (e) => {
        // Only remove highlight if leaving the dropzone entirely
        if (!dropzone.contains(e.relatedTarget)) {
            dropzone.classList.remove("drag-over");
            dropArea.classList.remove("drag-over");
        }
    });

    window.addEventListener("drop", (e) => {
        dropzone.classList.remove("drag-over");
        dropArea.classList.remove("drag-over");

        const files = e.dataTransfer?.files;
        if (files && files.length > 0 && files[0].type.startsWith("image/")) {
            processImage(files[0]);
        }
    });

    // Click to browse
    dropArea.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
        if (fileInput.files.length > 0) {
            processImage(fileInput.files[0]);
        }
    });
}

// --- Keyboard & mouse controls ---
function initControls() {
    const canvas = state.renderer.domElement;

    // Keyboard
    const movementKeys = new Set([
        "KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE",
        "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
        "Period", "Minus",
    ]);

    document.addEventListener("keydown", (e) => {
        state.keys[e.code] = true;
        state.keys[e.key] = true;

        if (movementKeys.has(e.code) || e.key === "-") {
            document.body.style.cursor = "none";
        }

        // H to toggle HUD
        if (e.code === "KeyH" && !e.repeat) {
            state.hudVisible = !state.hudVisible;
            document.getElementById("hud").classList.toggle("hidden", !state.hudVisible);
        }
    });

    document.addEventListener("keyup", (e) => {
        state.keys[e.code] = false;
        state.keys[e.key] = false;
    });

    // Mouse button state
    canvas.addEventListener("mousedown", (e) => {
        if (e.button === 0) {
            state.mouseDown = true;
            canvas.style.cursor = "none";
        }
    });
    document.addEventListener("mouseup", (e) => {
        if (e.button === 0) {
            state.mouseDown = false;
            canvas.style.cursor = "";
        }
    });

    // Orbit distance controls
    const orbitSlider = document.getElementById("orbit-distance");
    const orbitNum = document.getElementById("orbit-distance-num");
    function setOrbitDistance(val) {
        state.orbitDistance = val;
        orbitSlider.value = Math.min(val, parseFloat(orbitSlider.max));
        orbitNum.value = parseFloat(val.toFixed(2));
    }
    orbitSlider.addEventListener("input", () => {
        setOrbitDistance(parseFloat(orbitSlider.value));
    });
    orbitNum.addEventListener("input", () => {
        const v = parseFloat(orbitNum.value);
        if (!isNaN(v) && v >= 0) setOrbitDistance(v);
    });

    // Regenerate cache button
    document.getElementById("regen-button").addEventListener("click", regenerateCache);

    // Double-click: raycast to set orbit distance from nearest splat
    canvas.addEventListener("dblclick", (e) => {
        if (!state.splatMesh) return;

        const mouse = new THREE.Vector2(
            (e.clientX / window.innerWidth) * 2 - 1,
            -(e.clientY / window.innerHeight) * 2 + 1
        );

        const raycaster = new THREE.Raycaster();
        raycaster.setup && raycaster.setup({ far: 1000 });
        raycaster.setFromCamera(mouse, state.camera);

        const intersects = [];
        state.splatMesh.raycast(raycaster, intersects);

        if (intersects.length > 0) {
            // Use nearest hit distance
            intersects.sort((a, b) => a.distance - b.distance);
            const dist = intersects[0].distance;
            setOrbitDistance(dist);
            console.log("Orbit distance set to", dist.toFixed(2), "from raycast");
        } else {
            console.log("No splat hit under cursor");
        }
    });

    // Mouse: button up = parallax strafe, button down = rotate camera
    document.addEventListener("mousemove", (e) => {
        document.body.style.cursor = "";
        if (state.mouseDown) {
            // Compute pivot point at orbitDistance ahead of camera
            const oldForward = new THREE.Vector3(0, 0, -1).applyQuaternion(state.camera.quaternion);
            const pivot = state.cameraHome.clone().add(oldForward.multiplyScalar(state.orbitDistance));

            // Rotate camera orientation
            state.euler.setFromQuaternion(state.camera.quaternion);
            state.euler.y -= e.movementX * state.lookSpeed;
            state.euler.x -= e.movementY * state.lookSpeed;
            state.euler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, state.euler.x));
            state.camera.quaternion.setFromEuler(state.euler);

            // Move camera to maintain orbit around pivot
            if (state.orbitDistance > 0) {
                const newForward = new THREE.Vector3(0, 0, -1).applyQuaternion(state.camera.quaternion);
                state.cameraHome.copy(pivot).sub(newForward.multiplyScalar(state.orbitDistance));
            }
        } else {
            // Parallax strafe
            state.mouseNDC.x = -((e.clientX / window.innerWidth) * 2 - 1);
            state.mouseNDC.y = (e.clientY / window.innerHeight) * 2 - 1;
        }
    });
}

// --- WebXR / VR ---
function initXR() {
    // FpsMovement from Spark — handles XR controller thumbsticks as split gamepad.
    // Left stick = move, right stick = look. Disabled on desktop.
    state.xrFpsMovement = new FpsMovement({
        xr: state.renderer.xr,
        moveSpeed: 0.5,
        rotateSpeed: 1.5,
    });
    state.xrFpsMovement.enable = false;

    // VR button — only show if WebXR is supported
    if (navigator.xr) {
        navigator.xr.isSessionSupported("immersive-vr").then((supported) => {
            if (!supported) {
                console.log("WebXR immersive-vr not supported on this device");
                return;
            }
            const btn = document.getElementById("vr-button");
            btn.classList.remove("hidden");
            btn.addEventListener("click", toggleVR);
        });
    }

    // Listen for session end (e.g. user takes off headset or presses home)
    state.renderer.xr.addEventListener("sessionend", () => {
        console.log("XR session ended");
        state.xrSession = null;
        state.xrFpsMovement.enable = false;
        document.getElementById("vr-button").textContent = "Enter VR";
        // Restore desktop camera position from rig
        state.camera.position.copy(state.cameraHome);
        state.cameraRig.position.set(0, 0, 0);
        state.cameraRig.quaternion.identity();
    });
}

async function toggleVR() {
    if (state.xrSession) {
        state.xrSession.end();
        return;
    }

    try {
        const session = await navigator.xr.requestSession("immersive-vr", {
            optionalFeatures: ["local-floor", "bounded-floor"],
        });
        state.xrSession = session;
        state.renderer.xr.setSession(session);

        // Move rig to where the desktop camera was, reset camera local position
        state.cameraRig.position.copy(state.cameraHome);
        state.cameraRig.quaternion.setFromEuler(state.euler);
        state.camera.position.set(0, 0, 0);
        state.camera.quaternion.identity();

        state.xrFpsMovement.enable = true;
        document.getElementById("vr-button").textContent = "Exit VR";
        console.log("XR session started");
    } catch (err) {
        console.error("Failed to start XR session:", err);
    }
}

function updateXRInput(dt) {
    if (!state.xrSession) return;

    const session = state.renderer.xr.getSession();
    if (!session) return;

    const sources = Array.from(session.inputSources || []);

    // Check if either grip is held for speed boost (like shift on keyboard)
    // Grip is buttons[1] on Quest controllers
    let speedMultiplier = 1.0;
    let anyGripHeld = false;
    for (const source of sources) {
        const gp = source.gamepad;
        if (gp && gp.buttons[1] && gp.buttons[1].pressed) {
            anyGripHeld = true;
            break;
        }
    }
    if (anyGripHeld) speedMultiplier = 3.0;

    // FpsMovement handles thumbstick locomotion on the rig
    const savedSpeed = state.xrFpsMovement.moveSpeed;
    state.xrFpsMovement.moveSpeed = savedSpeed * speedMultiplier;
    state.xrFpsMovement.update(dt, state.cameraRig);
    state.xrFpsMovement.moveSpeed = savedSpeed;

    // Vertical movement: left trigger = down, right trigger = up
    // Trigger is buttons[0] (analog 0-1) on Quest controllers
    const verticalSpeed = 1.0 * speedMultiplier;
    for (const source of sources) {
        const gp = source.gamepad;
        if (!gp || !gp.buttons[0]) continue;
        const triggerValue = gp.buttons[0].value;
        if (triggerValue > 0.05) {
            if (source.handedness === "left") {
                state.cameraRig.position.y -= triggerValue * verticalSpeed * dt;
            } else if (source.handedness === "right") {
                state.cameraRig.position.y += triggerValue * verticalSpeed * dt;
            }
        }
    }

    // Reset: long-press both squeeze/grip buttons to reset position
    let bothSqueezed = sources.length >= 2;
    for (const source of sources) {
        const gp = source.gamepad;
        if (!gp || !gp.buttons[1] || !gp.buttons[1].pressed) {
            bothSqueezed = false;
            break;
        }
    }

    if (bothSqueezed) {
        state.xrResetHeld += dt;
        if (state.xrResetHeld >= state.xrResetThreshold && !state.xrResetDone) {
            console.log("VR position reset");
            state.cameraRig.position.set(0, 0, 0);
            state.cameraRig.quaternion.identity();
            state.xrResetDone = true;
        }
    } else {
        state.xrResetHeld = 0;
        state.xrResetDone = false;
    }
}

function updateMovement(dt) {
    if (!state.splatMesh) return;

    // In VR, locomotion is handled by FpsMovement + head tracking
    if (state.xrSession) {
        updateXRInput(dt);
        return;
    }

    // --- Desktop controls ---

    // WASD + QE movement (always active)
    const speed = state.moveSpeed * (state.keys["ShiftLeft"] || state.keys["ShiftRight"] ? 3.0 : 1.0);
    const velocity = new THREE.Vector3();

    if (state.keys["KeyW"] || state.keys["ArrowUp"])    velocity.z -= 1;
    if (state.keys["KeyS"] || state.keys["ArrowDown"])  velocity.z += 1;
    if (state.keys["KeyA"] || state.keys["ArrowLeft"])  velocity.x -= 1;
    if (state.keys["KeyD"] || state.keys["ArrowRight"]) velocity.x += 1;
    if (state.keys["KeyE"] || state.keys["-"])  velocity.y += 1;
    if (state.keys["KeyQ"] || state.keys["Period"]) velocity.y -= 1;

    if (velocity.length() > 0) {
        velocity.normalize().multiplyScalar(speed * dt);
        velocity.applyQuaternion(state.camera.quaternion);
        state.cameraHome.add(velocity);
    }

    // Mouse parallax: smoothly strafe around current home position
    // Disable parallax offset while orbiting (mouse button held)
    const px = state.mouseDown ? 0 : state.mouseNDC.x * state.parallaxStrength;
    const py = state.mouseDown ? 0 : state.mouseNDC.y * state.parallaxStrength;
    state.parallaxTarget.set(
        state.cameraHome.x + px,
        state.cameraHome.y + py,
        state.cameraHome.z
    );
    state.parallaxCurrent.lerp(state.parallaxTarget, state.parallaxLerp);
    state.camera.position.copy(state.parallaxCurrent);
}

// --- Render loop ---
function startRenderLoop() {
    const clock = new THREE.Clock();

    let frameCount = 0;
    state.renderer.setAnimationLoop(() => {
        const dt = clock.getDelta();
        updateMovement(dt);
        state.renderer.render(state.scene, state.camera);

        if (++frameCount % 300 === 0 && state.splatMesh) {
            console.log("Splats:", state.splatMesh.numSplats, "| FPS:", Math.round(1 / dt));
        }
    });
}

// --- URL params ---
const splatExtensions = /\.(ply|sog|spz|splat|ksplat)$/i;

// Load a splat URL and, if a sibling meta.json exists, apply its camera FOV first.
// SHARP embeds focal length in the .ply's `intrinsic` element but Spark ignores it,
// and .sog has no place for it — so we write a sidecar meta.json next to the splat.
async function loadSplatWithMeta(splatUrl) {
    const metaUrl = splatUrl.replace(/[?#].*$/, '').replace(/\/[^\/]+$/, '/meta.json');
    try {
        const resp = await fetch(metaUrl);
        if (resp.ok) setCameraFromMeta(await resp.json());
    } catch (_) { /* no sidecar — default FOV */ }
    loadSplat(splatUrl);
}

function checkUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const inputParam = params.get("input");
    if (!inputParam) return;

    // Splat file → load directly; anything else → treat as image URL → API
    const clean = inputParam.split(/[?#]/, 1)[0];
    if (splatExtensions.test(clean)) {
        hideDropzone();
        loadSplatWithMeta(inputParam);
    } else {
        processImageFromUrl(inputParam);
    }
}

// --- Boot ---
function init() {
    initRenderer();
    initDragDrop();
    initControls();
    initXR();
    startRenderLoop();
    checkUrlParams();
}

init();
