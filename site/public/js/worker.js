import * as ort from '/js/tiefling/node_modules/onnxruntime-web/dist/ort.all.mjs';
let initialized = false;

/**
 * Convert RGBA to RGB, then reformat as RRRR... GGGG... BBBB
 * @param input_imageData
 * @param width
 * @param height
 * @returns {Float32Array}
 */
function preprocessImage(input_imageData, width, height) {
    var floatArr = new Float32Array(width * height * 3);
    var floatArr1 = new Float32Array(width * height * 3);
    var floatArr2 = new Float32Array(width * height * 3);

    var j = 0;
    for (let i = 1; i < input_imageData.data.length + 1; i++) {
        if (i % 4 !== 0) {
            floatArr[j] = input_imageData.data[i - 1] / 255; // red
            j = j + 1;
        }
    }
    for (let i = 1; i < floatArr.length + 1; i += 3) {
        floatArr1[i - 1] = floatArr[i - 1]; // red
        floatArr1[i] = floatArr[i]; // green
        floatArr1[i + 1] = floatArr[i + 1]; // blue
    }
    var k = 0;
    for (let i = 0; i < floatArr.length; i += 3) {
        floatArr2[k] = floatArr[i]; // red
        k = k + 1;
    }
    var l = k;
    for (let i = 1; i < floatArr.length; i += 3) {
        floatArr2[l] = floatArr[i]; // green
        l = l + 1;
    }
    var m = l;
    for (let i = 2; i < floatArr.length; i += 3) {
        floatArr2[m] = floatArr[i]; // blue
        m = m + 1;
    }
    return floatArr2;
}

/**
 * convert depth map tensor to ImageData object
 * thx to akbartus https://github.com/akbartus/DepthAnything-on-Browser
 * @param tensor
 * @returns {ImageData}
 */
function postprocessImage(tensor) {
    const height = tensor.dims[1];
    const width = tensor.dims[2];

    const imageData = new ImageData(width, height);
    const data = imageData.data;

    const tensorData = new Float32Array(tensor.data.buffer);
    let max_depth = 0;
    let min_depth = Infinity;

    // Find the min and max depth values
    for (let h = 0; h < height; h++) {
        for (let w = 0; w < width; w++) {
            const tensorIndex = h * width + w;
            const value = tensorData[tensorIndex];
            if (value > max_depth) max_depth = value;
            if (value < min_depth) min_depth = value;
        }
    }

    // Normalize and fill ImageData
    for (let h = 0; h < height; h++) {
        for (let w = 0; w < width; w++) {
            const tensorIndex = h * width + w;
            const value = tensorData[tensorIndex];
            const depth = ((value - min_depth) / (max_depth - min_depth)) * 255;

            data[(h * width + w) * 4] = Math.round(depth);
            data[(h * width + w) * 4 + 1] = Math.round(depth);
            data[(h * width + w) * 4 + 2] = Math.round(depth);
            data[(h * width + w) * 4 + 3] = 255;
        }
    }

    return imageData;
}


self.onmessage = async function(e) {
    const { type } = e.data;

    if (type === 'init') {
        ort.env.wasm.wasmPaths = e.data.wasmPaths;
        initialized = true;
        return;
    }

    if (!initialized) {
        self.postMessage({ error: 'Worker not initialized' });
        return;
    }

    const {
        imageData,
        size,
        onnxModel,
        dilateRadius = 0,
    } = e.data;

    try {
        // Detect WebGPU availability in this worker
        const webgpuAvailable = typeof navigator !== 'undefined' && 'gpu' in navigator;

        // Try WebGPU first, fall back to WASM
        const executionProviders = webgpuAvailable
            ? ['webgpu', 'wasm']
            : ['wasm'];

        const session = await ort.InferenceSession.create(onnxModel, {
            executionProviders
        });

        const preprocessed = preprocessImage(imageData, imageData.width, imageData.height);
        const input = new ort.Tensor('float32', preprocessed, [1, 3, size, size]);
        const results = await session.run({ image: input });

        // Postprocess
        let depthImage = postprocessImage(results.depth);

        // Report which backend was used
        const backend = webgpuAvailable ? 'webgpu' : 'wasm';

        // Send back result
        self.postMessage({ processedImageData: depthImage, backend }, [depthImage.data.buffer]);
    } catch (error) {
        self.postMessage({ error: error.message });
    }
};
