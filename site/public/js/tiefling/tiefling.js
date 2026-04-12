import * as THREE from '/js/tiefling/node_modules/three/build/three.module.js';

export const Tiefling = function(container, options = {}) {

    const possibleDisplayModes = ['full', 'hsbs', 'fsbs', 'anaglyph'];
    this.displayMode = options.displayMode || 'full';
    if (!possibleDisplayModes.includes(this.displayMode)) {
        this.displayMode = 'full';
    }

    // simulate mouse movement after a while for auto rotation
    this.idleMovementEnabled = options.idleMovementEnabled ?? true;
    this.idleMovementAfter = options.idleMovementAfter || 3000;

    this.depthmapSize = options.depthmapSize || 1024;

    this.focus = options.focus ?? 0.25;
    this.baseMouseSensitivity = options.baseMouseSensitivity || 0.5;
    this.devicePixelRatio = options.devicePixelRatio || Math.min(window.devicePixelRatio, 2) || 1;
    this.expandDepthmapRadius = options.expandDepthmapRadius ?? 7;
    this.mouseXOffset = options.mouseXOffset ?? 0.2;

    let view1, view2;
    let lastMouseMovementTime = Date.now();

    const onMouseMove = (event, manual = true) => {

        if (manual) {
            lastMouseMovementTime = Date.now();
        }

        if (view1) {
            view1.onMouseMove(event);
        }
        if (view2) {
            let view2Event = new MouseEvent(event.type, {
                clientX: event.clientX + (container.offsetWidth / 2),
                clientY: event.clientY
            });
            view2.onMouseMove(view2Event);
        }
    }

    /**
     *
     * @param image - path to image
     * @param depthMap - path to depth map
     */
    const load3DImage = (image, depthMap) => {

        if (view1) {
            view1.destroy();
        }

        if (this.displayMode === 'hsbs' || this.displayMode === 'fsbs' || this.displayMode === 'anaglyph') {

            view1 = TieflingView(container.querySelector('.inner .container-left'), image, depthMap, {
                focus: this.focus,
                baseMouseSensitivity: this.baseMouseSensitivity,
                devicePixelRatio: this.devicePixelRatio,
                expandDepthmapRadius: this.expandDepthmapRadius,
            });

            if (view2) {
                view2.destroy();
            }
            view2 = TieflingView(container.querySelector('.inner .container-right'), image, depthMap, {
                mouseXOffset: -this.mouseXOffset,
                focus: this.focus,
                baseMouseSensitivity: this.baseMouseSensitivity,
                devicePixelRatio: this.devicePixelRatio,
                expandDepthmapRadius: this.expandDepthmapRadius,
            });
        } else {
            view1 = TieflingView(container.querySelector('.inner .container-left'), image, depthMap, {
                mouseXOffset: 0,
                focus: this.focus,
                baseMouseSensitivity: this.baseMouseSensitivity,
                devicePixelRatio: this.devicePixelRatio,
                expandDepthmapRadius: this.expandDepthmapRadius,
            });
        }
    }

    // check if the mouse hasn't been moved in 3 seconds. if so, move the mouse in a circle around the center of the container
    const checkMouseMovement = () => {

        if (this.idleMovementEnabled && this.idleMovementAfter >= 0 && Date.now() - lastMouseMovementTime > this.idleMovementAfter) {

            let rect = container.getBoundingClientRect();

            let centerX = rect.left + rect.width / 2;
            let centerY = rect.top + rect.height / 2;

            let radiusX = rect.width / 4;
            let radiusY = rect.height / 4;

            // account for aspect ratio of container
            if (rect.width > rect.height) {
                radiusY = radiusX * (rect.height / rect.width);
            } else {
                radiusX = radiusY * (rect.width / rect.height);
            }

            const speed = 0.001;
            const time = Date.now() * speed;

            const x = centerX + Math.cos(time) * radiusX;
            const y = centerY + Math.sin(time) * radiusY;

            // hide cursor
            document.body.style.cursor = 'none';

            onMouseMove({
                clientX: x,
                clientY: y
            }, false);
        } else {
            // show cursor
            document.body.style.cursor = 'default';
        }

        requestAnimationFrame(checkMouseMovement);
    }
    checkMouseMovement();


    /**
     * Load an image file and generate a depth map
     * @param file {File} Image file
     * @param depthmapSize {number} Size of the depth map. 512: pretty fast, good quality. 1024: slower, better quality. higher or lower might throw error
     * @returns {Promise<*>} URL of the depth map
     */
    const getDepthmapURL = async (file, depthmapSize = null) => {

        try {
            const result = await generateDepthmap(file, {depthmapSize: depthmapSize || this.depthmapSize});
            const depthCanvas = result.canvas;
            this.depthBackend = result.backend;
            console.log('Depth estimation backend:', result.backend);

            // convert depth map canvas to blob URL
            return await new Promise((resolve, reject) => {
                depthCanvas.toBlob(blob => {
                    if (blob) {
                        resolve(URL.createObjectURL(blob));
                    } else {
                        reject(new Error('failed to create blob from canvas'));
                    }
                });
            });

        } catch (error) {
            console.error("error in getDepthmapURL:", error);
            throw error;
        }
    }


    document.addEventListener('mousemove', onMouseMove);

    let lastTouchX = null;
    let lastTouchY = null;

    document.addEventListener('touchstart', (event) => {
        lastTouchX = event.touches[0].clientX;
        lastTouchY = event.touches[0].clientY;
    });

    document.addEventListener('touchmove', (event) => {
        const touchX = event.touches[0].clientX;
        const touchY = event.touches[0].clientY;

        // Map touch position directly to screen coordinates
        onMouseMove({
            clientX: touchX,
            clientY: touchY
        });

        lastTouchX = touchX;
        lastTouchY = touchY;
    });

    document.addEventListener('touchend', () => {
        lastTouchX = null;
        lastTouchY = null;
    });


    // create elements. tiefling-container > div.inner > div.container.container-left|.container-right
    let inner = document.createElement('div');
    inner.classList.add('inner');
    container.appendChild(inner);

    let container1 = document.createElement('div');
    container1.classList.add('container');
    container1.classList.add('container-left');
    inner.appendChild(container1);

    let container2 = document.createElement('div');
    container2.classList.add('container');
    container2.classList.add('container-right');
    inner.appendChild(container2);

    // add unique class to container
    let containerClass = "tiefling-" + Math.random().toString(36).substring(7);
    container.classList.add(containerClass);


    // add css
    let style = document.createElement('style');
    style.textContent = `
        .${containerClass} .inner {
            display: grid;
            width: 100vw;
            height: 100vh;
            grid-template-columns: 1fr;
        }
        
        .${containerClass} .inner .container {
            overflow: hidden;
        }
        .${containerClass} .inner .container-right {
            display: none;
        }
                
         /* Full/Half Side-by-Side: Stretch container by 2x, put two containers side by side, scale container down again */       
        .${containerClass}.hsbs .inner,
        .${containerClass}.fsbs .inner {
            width: 200vw;
            height: 100vh;
            grid-template-columns: 1fr 1fr;
        }
        .${containerClass}.hsbs .inner .container,
        .${containerClass}.fsbs .inner .container {
            width: 100vw;
            height: 100vh;            
        }
        .${containerClass}.hsbs .inner .container-right,
        .${containerClass}.fsbs .inner .container-right {
            display: block;
        }
        .${containerClass}.hsbs .inner {
            transform: scaleX(0.5);
        }
        .${containerClass}.fsbs .inner {
            transform: scale(0.5);
        }
        
        /* Anaglyph mode: Render containers on top of each other, with red/blue filters */
        .${containerClass}.anaglyph .inner {
            display: block;
            position: relative;
            width: 100vw;
            height: 100vh;
            filter: saturate(0.75);
        }
        .${containerClass}.anaglyph .inner .container {
            display: block;
            position: absolute;
            width: 100vw;
            height: 100vh;
        }
        .${containerClass}.anaglyph .inner .container.container-left {     
            background: red;
            background-blend-mode: lighten;
        }
        .${containerClass}.anaglyph .inner .container.container-right {         
            background: cyan;
            background-blend-mode: lighten;
            mix-blend-mode: darken;            
        }
        .${containerClass}.anaglyph .inner .container canvas {         
            mix-blend-mode: lighten;
        }
    `;
    document.head.appendChild(style);

    return {

        onMouseMove: onMouseMove,

        load3DImage: load3DImage,

        getDepthmapURL: getDepthmapURL,

        getDepthBackend: () => {
            return this.depthBackend || null;
        },

        getDepthmapSize: () => {
            return this.depthmapSize
        },
        setDepthmapSize: (size) => {
            this.depthmapSize = size;
        },


        getFocus: () => {
            return this.focus;
        },
        setFocus: (value) => {
            this.focus = value;
            if (view1) {
                view1.setFocus(this.focus);
            }
            if (view2) {
                view2.setFocus(this.focus);
            }
        },

        getBaseMouseSensitivity: () => {
            return this.baseMouseSensitivity;
        },
        setBaseMouseSensitivity: (value) => {
            this.baseMouseSensitivity = value;

            if (view1) {
                view1.setBaseMouseSensitivity(this.baseMouseSensitivity);
            }
            if (view2) {
                view2.setBaseMouseSensitivity(this.baseMouseSensitivity);
            }
        },

        getDevicePixelRatio: () => {
            return this.devicePixelRatio
        },
        setDevicePixelRatio: (size) => {
            this.devicePixelRatio = size;

            if (view1) {
                view1.setDevicePixelRatio(this.devicePixelRatio);
            }
            if (view2) {
                view2.setDevicePixelRatio(this.devicePixelRatio);
            }
        },

        getExpandDepthmapRadius: () => {
            return this.expandDepthmapRadius;
        },

        setExpandDepthmapRadius: (radius) => {
            this.expandDepthmapRadius = radius;
        },

        getPossibleDisplayModes: () => {
            return possibleDisplayModes;
        },

        setDisplayMode: (mode) => {
            this.displayMode = mode;
            container.classList.remove('hsbs');
            container.classList.remove('fsbs');
            container.classList.remove('anaglyph');
            container.classList.add(this.displayMode);
        },

        setMouseXOffset: (value) => {
            this.mouseXOffset = value;
            if (view2) {
                view2.setMouseXOffset(-this.mouseXOffset);
            }
        },

        setIdleMovementEnabled: (value) => {
            this.idleMovementEnabled = value;
        },

    }

}


// Persistent worker for depth estimation — kept alive so the ONNX session is cached between runs
let depthWorker = null;
let depthWorkerInitialized = false;

/**
 * Generate depth map from an image
 * @param options
 * @returns Promise of a canvas element
 * @constructor
 */
export const generateDepthmap = function(imageFile, options = {}) {

    const wasmPaths = options.wasmPaths || {
        'ort-wasm-simd-threaded.wasm': '/js/tiefling/onnx-wasm/ort-wasm-simd-threaded.wasm',
        'ort-wasm-simd-threaded.mjs': '/js/tiefling/onnx-wasm/ort-wasm-simd-threaded.mjs',
        'ort-wasm-simd-threaded.jsep.wasm': '/js/tiefling/onnx-wasm/ort-wasm-simd-threaded.jsep.wasm',
        'ort-wasm-simd-threaded.jsep.mjs': '/js/tiefling/onnx-wasm/ort-wasm-simd-threaded.jsep.mjs',
    };

    const onnxModel = options.onnxModel || '/models/depthanythingv2-vits-dynamic-quant.onnx';
    const onnxModelWebGPU = options.onnxModelWebGPU || '/models/depthanythingv2_model_fp16.onnx';

    const depthmapSize = options.depthmapSize || 512;


    /**
     * Generate a depth map from an image file using depth-anything-v2. calls a worker for the heavy lifting
     * @param imageFile {File} Image file
     * @param size 512: pretty fast, good quality. 1024: slower, better quality. higher or lower might throw error
     * @returns {Promise<HTMLCanvasElement>}
     */
    async function generate(imageFile, maxSize = 512) {
        try {
            const imageUrl = URL.createObjectURL(imageFile);

            // load image
            const image = new Image();
            await new Promise((resolve, reject) => {
                image.onload = resolve;
                image.onerror = () => reject(new Error('Failed to load image'));
                image.src = imageUrl;
            });


            // depht-anything-v2 wants the image to be square. so expand and scale it, then cut
            // the resulting depth map back down to the original aspect ratio and size

            const size = Math.min(
                maxSize,
                Math.max(image.width, image.height)
            );
            const scale = Math.min(size / image.width, size / image.height);
            const scaledWidth = Math.ceil(image.width * scale);
            const scaledHeight = Math.ceil(image.height * scale);

            // canvas of size of the image
            const resizedCanvas = document.createElement('canvas');
            const resizedCtx = resizedCanvas.getContext('2d');
            resizedCanvas.width = image.width;
            resizedCanvas.height = image.height;

            // draw image in canvas
            resizedCtx.drawImage(image, 0, 0);

            // two-step scaling and expanding, to avoid artifacts. not that it helps much

            // scale canvas down to scaledWidth, scaledHeight
            const scaledCanvas = document.createElement('canvas');
            const scaledCtx = scaledCanvas.getContext('2d');
            scaledCanvas.width = scaledWidth;
            scaledCanvas.height = scaledHeight;

            scaledCtx.drawImage(resizedCanvas, 0, 0, scaledWidth, scaledHeight);

            // expand canvas to size x size
            const expandedCanvas = document.createElement('canvas');
            const expandedCtx = expandedCanvas.getContext('2d');
            expandedCanvas.width = size;
            expandedCanvas.height = size;

            // draw image centered
            const offsetX = Math.ceil((size - scaledWidth) / 2);
            const offsetY = Math.ceil((size - scaledHeight) / 2);

            // to avoid white lines at the edges, stretch the image outwards a few pixel
            if (image.width > image.height) {
                expandedCtx.drawImage(scaledCanvas, offsetX, offsetY-2);
                expandedCtx.drawImage(scaledCanvas, offsetX, offsetY+2);
            } else if (image.height > image.width) {
                expandedCtx.drawImage(scaledCanvas, offsetX-2, offsetY);
                expandedCtx.drawImage(scaledCanvas, offsetX+2, offsetY);
            }

            expandedCtx.drawImage(scaledCanvas, offsetX, offsetY);

            const imageData = expandedCtx.getImageData(0, 0, size, size);

            // Create worker once, reuse for subsequent calls
            if (!depthWorker) {
                depthWorker = new Worker('/js/worker.js', {
                    type: 'module'
                });
            }

            if (!depthWorkerInitialized) {
                depthWorker.postMessage({
                    type: 'init',
                    wasmPaths: wasmPaths
                });
                depthWorkerInitialized = true;
            }

            const workerResult = await new Promise((resolve, reject) => {
                depthWorker.onmessage = function(e) {
                    if (e.data.error) {
                        reject(new Error(e.data.error));
                    } else {
                        resolve(e.data);
                    }
                };

                depthWorker.postMessage({
                    imageData,
                    size,
                    onnxModel,
                    onnxModelWebGPU,
                    wasmPaths
                });
            });

            const processedImageData = workerResult.processedImageData;
            const backend = workerResult.backend || 'wasm';

            // square temp canvas for the depth map
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = size;
            tempCanvas.height = size;
            const tempCtx = tempCanvas.getContext('2d');

            if (!(processedImageData instanceof ImageData)) {
                throw new Error('Invalid processed image data');
            }
            tempCtx.putImageData(processedImageData, 0, 0);

            // cut canvas back down to scaledWidth, scaledHeigh, keeping it centered
            const cutCanvas = document.createElement('canvas');
            const cutCtx = cutCanvas.getContext('2d');
            cutCanvas.width = scaledWidth;
            cutCanvas.height = scaledHeight;
            cutCtx.drawImage(tempCanvas, -offsetX, -offsetY, size, size);

            // scale back up to image width, image height
            const finalCanvas = document.createElement('canvas');
            const finalCtx = finalCanvas.getContext('2d');
            finalCanvas.width = image.width;
            finalCanvas.height = image.height;
            finalCtx.drawImage(cutCanvas, 0, 0, image.width, image.height);

            // clean up
            URL.revokeObjectURL(imageUrl);

            return { canvas: finalCanvas, backend };

        } catch (error) {
            console.error("error in generateDepthMap:", error);
            throw error;
        }
    }

    return generate(imageFile, depthmapSize);
}


/**
 * TieflingView - renders a single 3D view of an image and a depth map in a canvas.
 * @param container - container for the single canvas.
 * @param image - path to image
 * @param depthMap - path to depthmap
 * @param options
 * @returns {{destroy: *, onMouseMove: *, setFocus: *, setDevicePixelRatio: *, setMouseXOffset: * }}
 * @constructor
 */
export const TieflingView = function (container, image, depthMap, options) {

    let mouseXOffset = options.mouseXOffset ?? 0;

    let focus = options.focus ?? 0.25;
    let baseMouseSensitivity = options.baseMouseSensitivity || 0.5;
    let mouseSensitivityX = baseMouseSensitivity;
    let mouseSensitivityY = baseMouseSensitivity;
    let devicePixelRatio = options.devicePixelRatio || Math.min(window.devicePixelRatio, 2) || 1;
    let meshResolution = options.meshResolution || 1536;
    let meshDepth = options.meshDepth || 1;
    let expandDepthmapRadius = options.expandDepthmapRadius ?? 7;

    let containerWidth = container.offsetWidth;
    let containerHeight = container.offsetHeight;

    let camera, renderer, mesh;
    let mouseX = 0, mouseY = 0;
    let targetX = 0, targetY = 0;
    let imageAspectRatio;

    /// background and cut-off area
    let bgScene, mainScene, bgMesh;
    let scissorX = 0, scissorY = 0, scissorWidth = containerWidth, scissorHeight = containerHeight;


    const easing = 0.05; // higher: snappier movement
    let animationFrameId;


    let material;
    let uniforms = {
        map: { value: null },
        mouseDelta: { value: new THREE.Vector2(0, 0) },
        focus: { value: focus },
        meshDepth: { value: meshDepth },
        sensitivity: { value: baseMouseSensitivity }
    };

    // Helper function to detect if depth map is color or grayscale
    function isColorDepthMap(imageData) {
        const data = imageData.data;
        const sampleSize = Math.min(1000, Math.floor(data.length / 400)); // Sample every ~100 pixels
        let colorPixels = 0;
        
        for (let i = 0; i < sampleSize; i++) {
            const pixelIndex = (i * 100) * 4; // Every ~100th pixel
            if (pixelIndex + 2 >= data.length) break;
            
            const r = data[pixelIndex];
            const g = data[pixelIndex + 1];
            const b = data[pixelIndex + 2];
            
            // Check if pixel has significant color variation (not grayscale)
            // Allow small tolerance for compression artifacts
            if (Math.abs(r - g) > 3 || Math.abs(g - b) > 3 || Math.abs(r - b) > 3) {
                colorPixels++;
            }
        }
        
        // If >30% of sampled pixels have color variation, consider it a color depth map
        return (colorPixels / sampleSize) > 0.3;
    }

    // Turbo-to-grayscale conversion using exogen/turbo-colormap approach
    // Based on https://github.com/exogen/turbo-colormap
    const turboColormapFloat = new Float32Array([
        0.18995, 0.07176, 0.23217, 0.19483, 0.08339, 0.26149, 0.19956, 0.09498,
        0.29024, 0.20415, 0.10652, 0.31844, 0.2086, 0.11802, 0.34607, 0.21291,
        0.12947, 0.37314, 0.21708, 0.14087, 0.39964, 0.22111, 0.15223, 0.42558, 0.225,
        0.16354, 0.45096, 0.22875, 0.17481, 0.47578, 0.23236, 0.18603, 0.50004,
        0.23582, 0.1972, 0.52373, 0.23915, 0.20833, 0.54686, 0.24234, 0.21941,
        0.56942, 0.24539, 0.23044, 0.59142, 0.2483, 0.24143, 0.61286, 0.25107,
        0.25237, 0.63374, 0.25369, 0.26327, 0.65406, 0.25618, 0.27412, 0.67381,
        0.25853, 0.28492, 0.693, 0.26074, 0.29568, 0.71162, 0.2628, 0.30639, 0.72968,
        0.26473, 0.31706, 0.74718, 0.26652, 0.32768, 0.76412, 0.26816, 0.33825,
        0.7805, 0.26967, 0.34878, 0.79631, 0.27103, 0.35926, 0.81156, 0.27226, 0.3697,
        0.82624, 0.27334, 0.38008, 0.84037, 0.27429, 0.39043, 0.85393, 0.27509,
        0.40072, 0.86692, 0.27576, 0.41097, 0.87936, 0.27628, 0.42118, 0.89123,
        0.27667, 0.43134, 0.90254, 0.27691, 0.44145, 0.91328, 0.27701, 0.45152,
        0.92347, 0.27698, 0.46153, 0.93309, 0.2768, 0.47151, 0.94214, 0.27648,
        0.48144, 0.95064, 0.27603, 0.49132, 0.95857, 0.27543, 0.50115, 0.96594,
        0.27469, 0.51094, 0.97275, 0.27381, 0.52069, 0.97899, 0.27273, 0.5304,
        0.98461, 0.27106, 0.54015, 0.9893, 0.26878, 0.54995, 0.99303, 0.26592,
        0.55979, 0.99583, 0.26252, 0.56967, 0.99773, 0.25862, 0.57958, 0.99876,
        0.25425, 0.5895, 0.99896, 0.24946, 0.59943, 0.99835, 0.24427, 0.60937,
        0.99697, 0.23874, 0.61931, 0.99485, 0.23288, 0.62923, 0.99202, 0.22676,
        0.63913, 0.98851, 0.22039, 0.64901, 0.98436, 0.21382, 0.65886, 0.97959,
        0.20708, 0.66866, 0.97423, 0.20021, 0.67842, 0.96833, 0.19326, 0.68812,
        0.9619, 0.18625, 0.69775, 0.95498, 0.17923, 0.70732, 0.94761, 0.17223, 0.7168,
        0.93981, 0.16529, 0.7262, 0.93161, 0.15844, 0.73551, 0.92305, 0.15173,
        0.74472, 0.91416, 0.14519, 0.75381, 0.90496, 0.13886, 0.76279, 0.8955,
        0.13278, 0.77165, 0.8858, 0.12698, 0.78037, 0.8759, 0.12151, 0.78896, 0.86581,
        0.11639, 0.7974, 0.85559, 0.11167, 0.80569, 0.84525, 0.10738, 0.81381,
        0.83484, 0.10357, 0.82177, 0.82437, 0.10026, 0.82955, 0.81389, 0.0975,
        0.83714, 0.80342, 0.09532, 0.84455, 0.79299, 0.09377, 0.85175, 0.78264,
        0.09287, 0.85875, 0.7724, 0.09267, 0.86554, 0.7623, 0.0932, 0.87211, 0.75237,
        0.09451, 0.87844, 0.74265, 0.09662, 0.88454, 0.73316, 0.09958, 0.8904,
        0.72393, 0.10342, 0.896, 0.715, 0.10815, 0.90142, 0.70599, 0.11374, 0.90673,
        0.69651, 0.12014, 0.91193, 0.6866, 0.12733, 0.91701, 0.67627, 0.13526,
        0.92197, 0.66556, 0.14391, 0.9268, 0.65448, 0.15323, 0.93151, 0.64308,
        0.16319, 0.93609, 0.63137, 0.17377, 0.94053, 0.61938, 0.18491, 0.94484,
        0.60713, 0.19659, 0.94901, 0.59466, 0.20877, 0.95304, 0.58199, 0.22142,
        0.95692, 0.56914, 0.23449, 0.96065, 0.55614, 0.24797, 0.96423, 0.54303,
        0.2618, 0.96765, 0.52981, 0.27597, 0.97092, 0.51653, 0.29042, 0.97403,
        0.50321, 0.30513, 0.97697, 0.48987, 0.32006, 0.97974, 0.47654, 0.33517,
        0.98234, 0.46325, 0.35043, 0.98477, 0.45002, 0.36581, 0.98702, 0.43688,
        0.38127, 0.98909, 0.42386, 0.39678, 0.99098, 0.41098, 0.41229, 0.99268,
        0.39826, 0.42778, 0.99419, 0.38575, 0.44321, 0.99551, 0.37345, 0.45854,
        0.99663, 0.3614, 0.47375, 0.99755, 0.34963, 0.48879, 0.99828, 0.33816,
        0.50362, 0.99879, 0.32701, 0.51822, 0.9991, 0.31622, 0.53255, 0.99919,
        0.30581, 0.54658, 0.99907, 0.29581, 0.56026, 0.99873, 0.28623, 0.57357,
        0.99817, 0.27712, 0.58646, 0.99739, 0.26849, 0.59891, 0.99638, 0.26038,
        0.61088, 0.99514, 0.2528, 0.62233, 0.99366, 0.24579, 0.63323, 0.99195,
        0.23937, 0.64362, 0.98999, 0.23356, 0.65394, 0.98775, 0.22835, 0.66428,
        0.98524, 0.2237, 0.67462, 0.98246, 0.2196, 0.68494, 0.97941, 0.21602, 0.69525,
        0.9761, 0.21294, 0.70553, 0.97255, 0.21032, 0.71577, 0.96875, 0.20815,
        0.72596, 0.9647, 0.2064, 0.7361, 0.96043, 0.20504, 0.74617, 0.95593, 0.20406,
        0.75617, 0.95121, 0.20343, 0.76608, 0.94627, 0.20311, 0.77591, 0.94113,
        0.2031, 0.78563, 0.93579, 0.20336, 0.79524, 0.93025, 0.20386, 0.80473,
        0.92452, 0.20459, 0.8141, 0.91861, 0.20552, 0.82333, 0.91253, 0.20663,
        0.83241, 0.90627, 0.20788, 0.84133, 0.89986, 0.20926, 0.8501, 0.89328,
        0.21074, 0.85868, 0.88655, 0.2123, 0.86709, 0.87968, 0.21391, 0.8753, 0.87267,
        0.21555, 0.88331, 0.86553, 0.21719, 0.89112, 0.85826, 0.2188, 0.8987, 0.85087,
        0.22038, 0.90605, 0.84337, 0.22188, 0.91317, 0.83576, 0.22328, 0.92004,
        0.82806, 0.22456, 0.92666, 0.82025, 0.2257, 0.93301, 0.81236, 0.22667,
        0.93909, 0.80439, 0.22744, 0.94489, 0.79634, 0.228, 0.95039, 0.78823, 0.22831,
        0.9556, 0.78005, 0.22836, 0.96049, 0.77181, 0.22811, 0.96507, 0.76352,
        0.22754, 0.96931, 0.75519, 0.22663, 0.97323, 0.74682, 0.22536, 0.97679,
        0.73842, 0.22369, 0.98, 0.73, 0.22161, 0.98289, 0.7214, 0.21918, 0.98549,
        0.7125, 0.2165, 0.98781, 0.7033, 0.21358, 0.98986, 0.69382, 0.21043, 0.99163,
        0.68408, 0.20706, 0.99314, 0.67408, 0.20348, 0.99438, 0.66386, 0.19971,
        0.99535, 0.65341, 0.19577, 0.99607, 0.64277, 0.19165, 0.99654, 0.63193,
        0.18738, 0.99675, 0.62093, 0.18297, 0.99672, 0.60977, 0.17842, 0.99644,
        0.59846, 0.17376, 0.99593, 0.58703, 0.16899, 0.99517, 0.57549, 0.16412,
        0.99419, 0.56386, 0.15918, 0.99297, 0.55214, 0.15417, 0.99153, 0.54036,
        0.1491, 0.98987, 0.52854, 0.14398, 0.98799, 0.51667, 0.13883, 0.9859, 0.50479,
        0.13367, 0.9836, 0.49291, 0.12849, 0.98108, 0.48104, 0.12332, 0.97837, 0.4692,
        0.11817, 0.97545, 0.4574, 0.11305, 0.97234, 0.44565, 0.10797, 0.96904,
        0.43399, 0.10294, 0.96555, 0.42241, 0.09798, 0.96187, 0.41093, 0.0931,
        0.95801, 0.39958, 0.08831, 0.95398, 0.38836, 0.08362, 0.94977, 0.37729,
        0.07905, 0.94538, 0.36638, 0.07461, 0.94084, 0.35566, 0.07031, 0.93612,
        0.34513, 0.06616, 0.93125, 0.33482, 0.06218, 0.92623, 0.32473, 0.05837,
        0.92105, 0.31489, 0.05475, 0.91572, 0.3053, 0.05134, 0.91024, 0.29599,
        0.04814, 0.90463, 0.28696, 0.04516, 0.89888, 0.27824, 0.04243, 0.89298,
        0.26981, 0.03993, 0.88691, 0.26152, 0.03753, 0.88066, 0.25334, 0.03521,
        0.87422, 0.24526, 0.03297, 0.8676, 0.2373, 0.03082, 0.86079, 0.22945, 0.02875,
        0.8538, 0.2217, 0.02677, 0.84662, 0.21407, 0.02487, 0.83926, 0.20654, 0.02305,
        0.83172, 0.19912, 0.02131, 0.82399, 0.19182, 0.01966, 0.81608, 0.18462,
        0.01809, 0.80799, 0.17753, 0.0166, 0.79971, 0.17055, 0.0152, 0.79125, 0.16368,
        0.01387, 0.7826, 0.15693, 0.01264, 0.77377, 0.15028, 0.01148, 0.76476,
        0.14374, 0.01041, 0.75556, 0.13731, 0.00942, 0.74617, 0.13098, 0.00851,
        0.73661, 0.12477, 0.00769, 0.72686, 0.11867, 0.00695, 0.71692, 0.11268,
        0.00629, 0.7068, 0.1068, 0.00571, 0.6965, 0.10102, 0.00522, 0.68602, 0.09536,
        0.00481, 0.67535, 0.0898, 0.00449, 0.66449, 0.08436, 0.00424, 0.65345,
        0.07902, 0.00408, 0.64223, 0.0738, 0.00401, 0.63082, 0.06868, 0.00401,
        0.61923, 0.06367, 0.0041, 0.60746, 0.05878, 0.00427, 0.5955, 0.05399, 0.00453,
        0.58336, 0.04931, 0.00486, 0.57103, 0.04474, 0.00529, 0.55852, 0.04028,
        0.00579, 0.54583, 0.03593, 0.00638, 0.53295, 0.03169, 0.00705, 0.51989,
        0.02756, 0.0078, 0.50664, 0.02354, 0.00863, 0.49321, 0.01963, 0.00955, 0.4796,
        0.01583, 0.01055
    ]);

    // Convert float array to RGB lookup table
    const rgbColormap = new Array(256);
    for (let i = 0; i < 256; i++) {
        const flatIndex = i * 3;
        const r = Math.floor(turboColormapFloat[flatIndex] * 255);
        const g = Math.floor(turboColormapFloat[flatIndex + 1] * 255);
        const b = Math.floor(turboColormapFloat[flatIndex + 2] * 255);
        rgbColormap[i] = [r, g, b];
    }

    // Simple brute-force nearest neighbor search (since we can't use k-d tree in browser without import)
    const turboColorCache = new Map();

    function snapColorToIntensity(rgbColor, cache = turboColorCache) {
        const cacheKey = `${rgbColor[0]},${rgbColor[1]},${rgbColor[2]}`;
        const cachedValue = cache.get(cacheKey);
        if (cachedValue != null) {
            return cachedValue;
        }

        let bestDistance = Infinity;
        let bestIndex = 0;
        
        for (let i = 0; i < rgbColormap.length; i++) {
            const [tr, tg, tb] = rgbColormap[i];
            const distance = Math.sqrt(
                (rgbColor[0] - tr) ** 2 + 
                (rgbColor[1] - tg) ** 2 + 
                (rgbColor[2] - tb) ** 2
            );
            
            if (distance < bestDistance) {
                bestDistance = distance;
                bestIndex = i;
            }
        }

        cache.set(cacheKey, bestIndex);
        return bestIndex;
    }

    init();
    animate();

    function init() {
        bgScene = new THREE.Scene();
        mainScene = new THREE.Scene();
        mainScene.background = null;

        const fov = 45;
        camera = new THREE.PerspectiveCamera(fov, containerWidth / containerHeight, 0.1, 1000);
        camera.position.z = 4;
        camera.lookAt(0, 0, 0);

        renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
        renderer.outputEncoding = THREE.sRGBEncoding;
        renderer.setPixelRatio(devicePixelRatio);
        renderer.setSize(containerWidth, containerHeight);


        updateScissorDimensions();


        container.appendChild(renderer.domElement);

        const textureLoader = new THREE.TextureLoader();
        const imagePromise = new Promise(resolve => {
            textureLoader.load(image, texture => {
                texture.encoding = THREE.sRGBEncoding;
                uniforms.map.value = texture;
                imageAspectRatio = texture.image.width / texture.image.height;
                resolve();
            });
        });

        const depthPromise = new Promise(resolve => {
            const img = new Image();
            img.src = depthMap;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                depthData = ctx.getImageData(0, 0, canvas.width, canvas.height);

                // Check if this is a color depth map (e.g., from Apple Depth Pro)
                isColorDepth = isColorDepthMap(depthData);
                if (isColorDepth) {
                    console.log('Detected color depth map, converting to grayscale using turbo-colormap approach...');
                    
                    // Convert the entire color depth map to grayscale immediately
                    const grayscaleData = new ImageData(depthData.width, depthData.height);
                    
                    for (let i = 0; i < depthData.data.length; i += 4) {
                        const r = depthData.data[i];
                        const g = depthData.data[i + 1];
                        const b = depthData.data[i + 2];
                        
                        // Convert turbo color to grayscale intensity
                        const grayValue = snapColorToIntensity([r, g, b]);
                        
                        grayscaleData.data[i] = grayValue;     // R
                        grayscaleData.data[i + 1] = grayValue; // G
                        grayscaleData.data[i + 2] = grayValue; // B
                        grayscaleData.data[i + 3] = 255;       // A
                    }
                    
                    // Replace the color depth data with grayscale
                    depthData = grayscaleData;
                    isColorDepth = false; // Now it's grayscale, treat it normally
                    console.log('Color depth map converted to grayscale successfully');
                }

                // Expand depth map to fill in gaps
                if (expandDepthmapRadius > 0) {
                    depthData = expandDepthMap(depthData, expandDepthmapRadius);
                }

                const geometry = createGeometry(
                    Math.min(meshResolution, img.width),
                    Math.min(meshResolution, img.height),
                    depthData
                );

                material = new THREE.ShaderMaterial({
                    vertexShader: `
                        uniform vec2 mouseDelta;
                        uniform float focus;
                        uniform float meshDepth;
                        uniform float sensitivity;
                        
                        attribute float depth;
                        
                        varying vec2 vUv;
                        
                        void main() {
                            vUv = uv;
                            vec3 pos = position;
                            
                            float actualDepth = depth * meshDepth;
                            float focusDepth = focus * meshDepth;
                            float cameraZ = 1.4;
                        
                            // Rotational displacement (relative to focus depth)
                            vec2 rotate = mouseDelta * sensitivity * 
                                (1.0 - focus) * 
                                (actualDepth - focusDepth) * 
                                vec2(-1.0, 1.0);
                        
                            // Calculate edge proximity factor (0 at edges, 1 in center)
                            float edgeWidth = 0.02; // controls edge stiffness
                            vec2 edgeFactorVec = smoothstep(0.0, edgeWidth, vUv) * 
                                                smoothstep(1.0, 1.0 - edgeWidth, vUv);
                            float edgeFactor = edgeFactorVec.x * edgeFactorVec.y;
                        
                            // Apply displacement with edge preservation
                            pos.xy += rotate * edgeFactor;
                        
                            gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
                        }
                    `,
                    fragmentShader: `
                        uniform sampler2D map;
                        varying vec2 vUv;

                        void main() {
                            gl_FragColor = texture2D(map, vUv);
                        }
                    `,
                    uniforms: uniforms,
                    side: THREE.DoubleSide
                });

                mesh = new THREE.Mesh(geometry, material);

                const containerAspect = containerWidth / containerHeight;
                const imageAspect = depthData.width / depthData.height;
                const visibleHeight = 2 * Math.tan(THREE.MathUtils.degToRad(fov/2)) * camera.position.z;
                const visibleWidth = visibleHeight * camera.aspect;

                let scale;
                if (containerAspect > imageAspect) {
                    scale = visibleHeight / geometry.parameters.height;
                } else {
                    scale = visibleWidth / geometry.parameters.width;
                }

                mesh.scale.set(scale, scale, 1);
                mainScene.add(mesh);

                resolve();
            };
        });

        Promise.all([imagePromise, depthPromise]).then(() => {
            onResize();
        });
    }

    function expandDepthMap(imageData, radius) {
        const width = imageData.width;
        const height = imageData.height;
        const src = imageData.data;
        const dst = new Uint8ClampedArray(src);

        for (let r = 0; r < radius; r++) {
            for (let y = 1; y < height-1; y++) {
                for (let x = 1; x < width-1; x++) {
                    const idx = (y * width + x) * 4;
                    const currentDepth = src[idx];

                    if (currentDepth < 10) continue;

                    // Simple dilation: spread to adjacent pixels
                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dx = -1; dx <= 1; dx++) {
                            const nIdx = ((y + dy) * width + (x + dx)) * 4;
                            if (src[nIdx] < currentDepth) {
                                dst[nIdx] = currentDepth;
                                dst[nIdx + 1] = currentDepth;
                                dst[nIdx + 2] = currentDepth;
                            }
                        }
                    }
                }
            }
            // Update source for next iteration
            src.set(dst);
        }
        return new ImageData(dst, width, height);
    }


    function createGeometry(width, height, depthData) {
        const imageAspect = depthData.width / depthData.height;
        const geometry = new THREE.PlaneGeometry(
            imageAspect,
            1,
            width - 1,
            height - 1
        );

        const vertices = geometry.attributes.position.array;
        const uvs = geometry.attributes.uv.array;
        const depths = new Float32Array(vertices.length / 3);
        let depthValue;

        // First pass: compute initial depths and positions
        for (let i = 0; i < vertices.length; i += 3) {
            const uvIndex = (i / 3) * 2;
            const u = Math.min(1, Math.max(0, uvs[uvIndex])); // Clamp UV coordinates
            const v = Math.min(1, Math.max(0, uvs[uvIndex + 1]));

            // Safely calculate pixel coordinates
            const x = Math.floor(u * (depthData.width - 1));
            const y = Math.floor((1 - v) * (depthData.height - 1));

            // Validate array index
            const pixelIndex = (y * depthData.width + x) * 4;
            if (pixelIndex + 3 >= depthData.data.length) {
                console.error('Invalid depthmap access at:', x, y);
                depthValue = 0;
            } else {
                // All depth maps are now grayscale (converted on load if needed)
                depthValue = depthData.data[pixelIndex] / 255;
            }

            const z = depthValue * meshDepth;
            const scaleFactor = (4 - z) / 4;

            vertices[i] *= scaleFactor;
            vertices[i + 1] *= scaleFactor;
            vertices[i + 2] = z;

            depths[i/3] = depthValue;
        }

        // Create depth grid and calculate gradients
        const gridWidth = width;
        const gridHeight = height;
        const depthGrid = new Array(gridWidth).fill().map(() => new Array(gridHeight));
        const gradientGrid = new Array(gridWidth).fill().map(() => new Array(gridHeight));

        for (let i = 0; i < depths.length; i++) {
            const x = i % gridWidth;
            const y = Math.floor(i / gridWidth);
            depthGrid[x][y] = depths[i];
        }

        // Pre-calculate gradients
        for (let x = 0; x < gridWidth; x++) {
            for (let y = 0; y < gridHeight; y++) {
                const dx = (x < gridWidth-1 ? depthGrid[x+1][y] : depthGrid[x][y]) -
                    (x > 0 ? depthGrid[x-1][y] : depthGrid[x][y]);
                const dy = (y < gridHeight-1 ? depthGrid[x][y+1] : depthGrid[x][y]) -
                    (y > 0 ? depthGrid[x][y-1] : depthGrid[x][y]);
                gradientGrid[x][y] = { dx, dy, mag: Math.sqrt(dx*dx + dy*dy) };
            }
        }

        // Smoothing pass for jagged edges
        const smoothIterations = 2;
        for (let iter = 0; iter < smoothIterations; iter++) {
            for (let i = 0; i < vertices.length; i += 3) {
                const vertexIndex = i / 3;
                const x = vertexIndex % gridWidth;
                const y = Math.floor(vertexIndex / gridWidth);

                if (gradientGrid[x][y].mag > 0.08) {
                    let avgX = 0, avgY = 0, avgZ = 0, count = 0;

                    // Average with neighbors
                    for (let dx = -1; dx <= 1; dx++) {
                        for (let dy = -1; dy <= 1; dy++) {
                            const nx = x + dx;
                            const ny = y + dy;
                            if (nx >= 0 && nx < gridWidth && ny >= 0 && ny < gridHeight) {
                                const idx = (ny * gridWidth + nx) * 3;
                                // Add validation for vertex indices
                                if (idx >= 0 && idx + 2 < vertices.length) {
                                    avgX += vertices[idx];
                                    avgY += vertices[idx + 1];
                                    avgZ += vertices[idx + 2];
                                    count++;
                                }
                            }
                        }
                    }

                    // Only update if we have valid samples
                    if (count > 0) {
                        vertices[i] = avgX / count;
                        vertices[i + 1] = avgY / count;
                        vertices[i + 2] = avgZ / count;
                    }
                }
            }
        }

        geometry.setAttribute('depth', new THREE.BufferAttribute(depths, 1));
        geometry.computeVertexNormals();
        return geometry;
    }

    function updateScissorDimensions() {
        if (!imageAspectRatio) return; // Skip if image hasn't loaded yet

        const containerAspect = containerWidth / containerHeight;
        if (containerAspect > imageAspectRatio) {
            scissorHeight = containerHeight;
            scissorWidth = containerHeight * imageAspectRatio;
        } else {
            scissorWidth = containerWidth;
            scissorHeight = containerWidth / imageAspectRatio;
        }
        scissorX = (containerWidth - scissorWidth) / 2;
        scissorY = (containerHeight - scissorHeight) / 2;
    }

    function animate() {
        animationFrameId = requestAnimationFrame(animate);

        // during rendering, strafing mouse movement seems stronger. so adjust based on focus
        // focus = 0.5: 1. focus = 0: 0.3
        const mouseSensitivityFocusFactor = 0.3 + 0.7 * 2 * focus;

        targetX += (mouseSensitivityFocusFactor * mouseX * mouseSensitivityX - targetX) * easing;
        targetY += (mouseSensitivityFocusFactor * mouseY * mouseSensitivityY - targetY) * easing;

        if (mesh) {
            uniforms.mouseDelta.value.set(targetX, -targetY);
            uniforms.focus.value = focus;
            uniforms.sensitivity.value = baseMouseSensitivity;
        }

        // Then render main scene with perspective camera and scissor
        if (scissorWidth > 0 && scissorHeight > 0) {
            renderer.setScissorTest(true);
            renderer.setScissor(scissorX, scissorY, scissorWidth, scissorHeight);
            renderer.render(mainScene, camera);
        }
    }

    function onMouseMove(event) {
        const rect = container.getBoundingClientRect();
        mouseX = Math.min(1, Math.max(-1, (event.clientX - rect.left) / containerWidth * 2 - 1));
        mouseY = Math.min(1, Math.max(-1, (event.clientY - rect.top) / containerHeight * 2 - 1));

        mouseX += 2 * mouseXOffset;

        mouseX = -mouseX;
    }

    function updateMouseSensitivity() {
        mouseSensitivityX = baseMouseSensitivity;
        mouseSensitivityY = baseMouseSensitivity;
    }

    const onResize = () => {
        containerWidth = container.offsetWidth;
        containerHeight = container.offsetHeight;

        renderer.setSize(containerWidth, containerHeight);
        camera.aspect = containerWidth / containerHeight;
        camera.updateProjectionMatrix();

        updateScissorDimensions();

        if (mesh) {
            const imageAspect = mesh.geometry.parameters.width / mesh.geometry.parameters.height;
            const containerAspect = containerWidth / containerHeight;

            const visibleHeight = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov/2)) * camera.position.z;
            const visibleWidth = visibleHeight * camera.aspect;

            let scale;
            if (containerAspect > imageAspect) {
                scale = visibleHeight / mesh.geometry.parameters.height;
            } else {
                scale = visibleWidth / mesh.geometry.parameters.width;
            }

            // Scale both meshes the same way
            mesh.scale.set(scale, scale, 1);
            if (bgMesh) {
                bgMesh.scale.set(scale, scale, 1);
            }
        }

        updateMouseSensitivity();
    };

    window.addEventListener('resize', onResize);


    // public methods
    // Debug function: Test turbo color conversion
    window.debugTurboConversion = function() {
        console.log('Testing turbo color conversion:');
        
        // Test boundary colors
        const turboBlue = rgbColormap[0];   // Index 0 = far (blue)
        const turboRed = rgbColormap[255];  // Index 255 = near (red)
        
        const blueIntensity = snapColorToIntensity(turboBlue);
        console.log(`Turbo blue RGB(${turboBlue.join(',')}) -> intensity: ${blueIntensity} (should be 0)`);
        
        const redIntensity = snapColorToIntensity(turboRed);
        console.log(`Turbo red RGB(${turboRed.join(',')}) -> intensity: ${redIntensity} (should be 255)`);
        
        // Test some sample colors
        const darkRed = snapColorToIntensity([185, 30, 0]);
        console.log(`Dark red RGB(185,30,0) -> intensity: ${darkRed} (should be high ~255)`);
        
        const blueColor = snapColorToIntensity([67, 72, 176]);
        console.log(`Blue RGB(67,72,176) -> intensity: ${blueColor} (should be low ~0)`);
        
        // Test middle range
        const turboMid = rgbColormap[127];
        const midIntensity = snapColorToIntensity(turboMid);
        console.log(`Turbo mid RGB(${turboMid.join(',')}) -> intensity: ${midIntensity} (should be ~127)`);
    };

    // Debug function: Show current depth map in new tab (already converted to grayscale if needed)
    window.debugColorToGrayscale = function() {
        if (!depthData) {
            console.log('No depth data loaded');
            return;
        }
        
        console.log('Opening current depth map in new tab (already converted to grayscale if it was color)...');
        
        const canvas = document.createElement('canvas');
        canvas.width = depthData.width;
        canvas.height = depthData.height;
        const ctx = canvas.getContext('2d');
        
        // Put the current depth data (already grayscale) on canvas
        ctx.putImageData(depthData, 0, 0);
        
        // Open in new tab
        canvas.toBlob(blob => {
            const url = URL.createObjectURL(blob);
            window.open(url, '_blank');
            console.log('Opened depth map in new tab');
        });
    };

    // Store depth data and detection result for debugging
    let depthData = null;
    let isColorDepth = false;

    return {

        destroy: function() {
            window.removeEventListener('resize', onResize);

            if (material.map) {
                material.map.dispose();
            }

            if (mesh) {
                mesh.geometry.dispose();
                material.dispose();
            }

            if (bgMesh) {
                bgMesh.geometry.dispose();
                bgMesh.material.dispose();
                bgScene.remove(bgMesh);
            }

            if (renderer) {
                renderer.dispose();
                container.removeChild(renderer.domElement);
            }

            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
            }

            mainScene = null;
            bgScene = null;
            camera = null;
            renderer = null;
            mesh = null;
            material = null;
        },

        onMouseMove: onMouseMove,

        setFocus: function(value) {
            focus = value;
        },
        setBaseMouseSensitivity: function(value) {
            baseMouseSensitivity = value;
            updateMouseSensitivity();
        },
        setDevicePixelRatio: function(value) {
            devicePixelRatio = value;
            if (renderer) {
                renderer.setPixelRatio(devicePixelRatio);
            }
        },
        setMouseXOffset: function(value) {
            mouseXOffset = value;
        },


        setExpandDepthmapRadius: function(value) {
            expandDepthmapRadius = value;
        }
    };

}