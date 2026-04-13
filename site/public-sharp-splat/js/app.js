import * as THREE from "three";
import { SplatMesh, SparkRenderer } from "@sparkjsdev/spark";

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
    // Camera home position (where the original photo was taken)
    cameraHome: new THREE.Vector3(0, 0, 0),
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
async function processImage(file) {
    showLoading("Uploading image…");

    const formData = new FormData();
    formData.append("image", file);

    try {
        showLoading("Generating 3D gaussian splat… (this takes ~20s)");
        const resp = await fetch("api.php", {
            method: "POST",
            body: formData,
        });

        if (!resp.ok) throw new Error(`Server error: ${resp.status}`);

        const data = await resp.json();
        if (data.state === "error") throw new Error(data.data);

        hideLoading();
        hideDropzone();

        // Load the .ply
        loadSplat(data.ply);
    } catch (err) {
        console.error("Processing failed:", err);
        hideLoading();
        showLoading("Error: " + err.message);
        setTimeout(hideLoading, 3000);
    }
}

async function processImageFromUrl(imageUrl) {
    showLoading("Fetching image…");

    try {
        const formData = new FormData();
        formData.append("imageUrl", imageUrl);

        showLoading("Generating 3D gaussian splat… (this takes ~20s)");
        const resp = await fetch("api.php", {
            method: "POST",
            body: formData,
        });

        if (!resp.ok) throw new Error(`Server error: ${resp.status}`);

        const data = await resp.json();
        if (data.state === "error") throw new Error(data.data);

        hideLoading();
        hideDropzone();

        loadSplat(data.ply);
    } catch (err) {
        console.error("Processing failed:", err);
        hideLoading();
        showLoading("Error: " + err.message);
        setTimeout(hideLoading, 3000);
    }
}

// --- UI helpers ---
const defaultTitle = document.title;

function showLoading(msg) {
    const el = document.getElementById("loading");
    el.classList.add("visible");
    el.querySelector(".message").textContent = msg || "Processing…";
    document.title = "🔴 " + (msg || "Processing…");
}

function hideLoading() {
    document.getElementById("loading").classList.remove("visible");
    document.title = defaultTitle;
}

function hideDropzone() {
    document.getElementById("dropzone").classList.add("hidden");
}

function showDropzone() {
    document.getElementById("dropzone").classList.remove("hidden");
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
    document.addEventListener("keydown", (e) => {
        state.keys[e.code] = true;

        // H to toggle HUD
        if (e.code === "KeyH" && !e.repeat) {
            state.hudVisible = !state.hudVisible;
            document.getElementById("hud").classList.toggle("hidden", !state.hudVisible);
        }
    });

    document.addEventListener("keyup", (e) => {
        state.keys[e.code] = false;
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

    // Mouse: button up = parallax strafe, button down = rotate camera
    document.addEventListener("mousemove", (e) => {
        if (state.mouseDown) {
            // Rotate camera
            state.euler.setFromQuaternion(state.camera.quaternion);
            state.euler.y -= e.movementX * state.lookSpeed;
            state.euler.x -= e.movementY * state.lookSpeed;
            state.euler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, state.euler.x));
            state.camera.quaternion.setFromEuler(state.euler);
        } else {
            // Parallax strafe
            state.mouseNDC.x = -((e.clientX / window.innerWidth) * 2 - 1);
            state.mouseNDC.y = (e.clientY / window.innerHeight) * 2 - 1;
        }
    });
}

function updateMovement(dt) {
    if (!state.splatMesh) return;

    // WASD + QE movement (always active)
    const speed = state.moveSpeed * (state.keys["ShiftLeft"] || state.keys["ShiftRight"] ? 3.0 : 1.0);
    const velocity = new THREE.Vector3();

    if (state.keys["KeyW"]) velocity.z -= 1;
    if (state.keys["KeyS"]) velocity.z += 1;
    if (state.keys["KeyA"]) velocity.x -= 1;
    if (state.keys["KeyD"]) velocity.x += 1;
    if (state.keys["KeyE"]) velocity.y += 1;
    if (state.keys["KeyQ"]) velocity.y -= 1;

    if (velocity.length() > 0) {
        velocity.normalize().multiplyScalar(speed * dt);
        velocity.applyQuaternion(state.camera.quaternion);
        state.cameraHome.add(velocity);
    }

    // Mouse parallax: smoothly strafe around current home position
    state.parallaxTarget.set(
        state.cameraHome.x + state.mouseNDC.x * state.parallaxStrength,
        state.cameraHome.y + state.mouseNDC.y * state.parallaxStrength,
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
function checkUrlParams() {
    const params = new URLSearchParams(window.location.search);

    // Direct .ply loading for development/testing
    const plyParam = params.get("ply");
    if (plyParam) {
        hideDropzone();
        loadSplat(plyParam);
        return;
    }

    // Image input → process via API
    const inputParam = params.get("input");
    if (inputParam) {
        processImageFromUrl(inputParam);
    }
}

// --- Boot ---
function init() {
    initRenderer();
    initDragDrop();
    initControls();
    startRenderLoop();
    checkUrlParams();
}

init();
