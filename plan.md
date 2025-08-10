# Tiefling Enhancement Plan - Inpainting for Better 3D Rendering

## Problem Statement

Tiefling generates "3D" images from 2D images by:
1. Creating a depth map (currently DepthAnythingV2, moving to Apple's depth-pro)
2. Building a 3D mesh from the depth map
3. Rendering with Three.js with mouse-based parallax effect

**Current Issue**: When the camera moves, foreground objects reveal background areas that don't exist in the original image. Currently using pixel stretching, which looks bad with textured backgrounds.

## Constraints & Requirements

### Camera Movement
- Limited movement: few degrees at most
- Supports VR SBS (side-by-side) mode: camera separation = eye distance
- Quality more important than extreme camera angles

### Processing Time
- Current: ~30s for depth map + 3s for mesh
- Acceptable: Up to 5 minutes for high quality
- Platform: Planning desktop app (Electron/Tauri/SwiftUI)

### Quality Goals
- Better depth maps (Apple depth-pro: 1.9GB model)
- Better gap-filling than pixel stretching
- Full resolution output (depth/mesh can be lower res)

### Scene Complexity
- Real-world images often have many depth layers (crowds, jungles, nature)
- Need smart segmentation that can handle complex scenes
- Must balance quality with processing time

## Solution: Smart Segmentation with Selective Inpainting

### Core Concept
Use a hybrid approach that combines:
1. **Pixel stretching** for small depth discontinuities (works well, fast)
2. **Segmentation and inpainting** for large depth discontinuities
3. **Separate mesh layers** at harsh edges to prevent stretching artifacts

### Key Architecture Change
Instead of a single mesh, create **separate mesh layers** at significant depth boundaries:
- Each layer has its own geometry
- No vertex connections across harsh depth edges
- Each layer can move independently without stretching

## Implementation Plan

### Phase 1: Smart Depth Segmentation

```javascript
function segmentDepthMap(depthMap, config = {
    minDiscontinuity: 0.1,  // Configurable threshold
    maxSegments: 10,        // Limit for performance
    mergeThreshold: 0.05    // Merge similar adjacent segments
}) {
    // 1. Compute depth gradients
    gradients = computeDepthGradients(depthMap);
    
    // 2. Find significant edges (gradient > minDiscontinuity)
    edges = findSignificantEdges(gradients, config.minDiscontinuity);
    
    // 3. Segment using connected components
    segments = [];
    visited = new Set();
    
    for (pixel of allPixels) {
        if (!visited.has(pixel)) {
            segment = floodFill(pixel, edges, visited);
            segments.push(segment);
        }
    }
    
    // 4. Merge similar segments if too many
    if (segments.length > config.maxSegments) {
        segments = mergeClosestSegments(segments, config.mergeThreshold);
    }
    
    return segments;
}
```

### Phase 2: Depth-Ordered Progressive Inpainting

**Critical Insight**: We need multiple inpainting passes, processing from back to front.

```javascript
function createLayeredInpainting(image, segments, depthMap) {
    // Sort segments by average depth (far to near)
    sortedSegments = segments.sort((a, b) => a.avgDepth - b.avgDepth);
    
    // Each segment gets its own background texture
    backgroundTextures = new Map();
    
    // Start with original image
    let currentImage = image.copy();
    
    // Process from furthest to nearest
    for (let i = 0; i < sortedSegments.length - 1; i++) {
        const segment = sortedSegments[i];
        
        // Create mask for this segment AND everything in front
        const mask = createMask();
        for (let j = i; j < sortedSegments.length; j++) {
            mask.add(sortedSegments[j].pixels);
        }
        
        // Dilate mask at segment boundaries
        const dilatedMask = dilateMaskAtBoundaries(mask, segment);
        
        // Inpaint
        const inpainted = await inpaintWithLaMa(currentImage, dilatedMask);
        
        // Store this as background for the next layer
        backgroundTextures.set(sortedSegments[i + 1].id, inpainted);
        
        // Update current image for next iteration
        currentImage = inpainted;
    }
    
    return backgroundTextures;
}
```

Example for 3-layer scene (sky, big sphere, small sphere):
```
Pass 1: Mask both spheres → Inpaint → Sky extended everywhere
Pass 2: Mask small sphere → Inpaint → Big sphere extended behind small
Result: Each layer has appropriate background
```

### Phase 3: Multi-Mesh Generation

**Key Change**: Create separate geometries for each segment.

```javascript
function createSegmentedMeshes(image, depthMap, segments, backgroundTextures) {
    const meshes = [];
    
    for (const segment of segments) {
        // Determine rendering strategy for this segment
        const strategy = determineStrategy(segment);
        
        if (strategy === 'STRETCH') {
            // Small discontinuities - use current approach
            const mesh = createStretchMesh(segment, image, depthMap);
            meshes.push(mesh);
            
        } else if (strategy === 'INPAINT') {
            // Large discontinuities - create separate layer
            const mesh = createLayerMesh({
                segment: segment,
                texture: image,
                backgroundTexture: backgroundTextures.get(segment.id),
                depthMap: depthMap,
                // Important: No vertex connections to other segments
                isolated: true
            });
            meshes.push(mesh);
        }
    }
    
    return meshes;
}

function determineStrategy(segment) {
    const maxGradient = Math.max(...segment.boundaryGradients);
    return maxGradient > 0.15 ? 'INPAINT' : 'STRETCH';
}
```

### Phase 4: Rendering with Multiple Meshes

```javascript
// Modified vertex shader - per mesh/segment
attribute float depth;
attribute float boundaryDistance; // Distance to segment boundary
varying float vBoundaryDistance;
varying vec2 vUv;

void main() {
    vUv = uv;
    vBoundaryDistance = boundaryDistance;
    
    // Existing displacement based on mouse
    vec3 pos = position;
    // ... displacement calculations ...
    
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}

// Fragment shader with background blending
uniform sampler2D texture;
uniform sampler2D backgroundTexture;
uniform float hasBackground;
varying float vBoundaryDistance;

void main() {
    vec4 original = texture2D(texture, vUv);
    
    if (hasBackground > 0.5) {
        vec4 background = texture2D(backgroundTexture, vUv);
        
        // Smooth transition at boundaries
        float alpha = smoothstep(0.0, 5.0, vBoundaryDistance); // 5px fade
        gl_FragColor = mix(background, original, alpha);
    } else {
        gl_FragColor = original;
    }
}
```

## Configuration Options

```javascript
const config = {
    segmentation: {
        minDiscontinuity: 0.1,    // When to consider edge significant
        maxSegments: 10,          // Performance limit
        mergeThreshold: 0.05      // When to merge similar segments
    },
    inpainting: {
        dilationRadius: 50,       // How far to extend behind edges
        resolution: 1024,         // Inpainting resolution
        provider: 'replicate',    // 'replicate' | 'local' | 'fal'
    },
    rendering: {
        stretchThreshold: 0.1,    // Below this, use stretching
        inpaintThreshold: 0.15,   // Above this, use inpainting
        fadeWidth: 5              // Pixels for boundary blending
    }
};
```

## Processing Pipeline

```
1. Load Image & Generate Depth Map
   ↓
2. Segment Depth Map
   - Identify significant discontinuities
   - Create N segments (typically 2-10)
   ↓
3. For Each Segment (back to front):
   - Determine strategy (stretch vs inpaint)
   - If inpaint: create mask, dilate, inpaint
   - Store background texture
   ↓
4. Generate Meshes
   - Create separate geometry per segment
   - No connections across harsh edges
   - Assign appropriate textures
   ↓
5. Render
   - Render all meshes
   - Each handles its own displacement
   - Blend with backgrounds at edges
```

## Handling Complex Scenes

### Crowd Example
```
Depth segments detected: 8 (far people, mid people, near people, etc.)
Strategy: 
- Merge similar-depth people into same segment
- Result: 3-4 effective layers
- Inpaint between major depth groups
```

### Jungle Example
```
Depth segments detected: 15+ (leaves at all depths)
Strategy:
- Use gradient-based merging
- Keep major discontinuities (tree trunks vs background)
- Use stretching for foliage gradients
- Result: 5-6 layers with mixed strategies
```

## Resolution Strategies

### Adaptive Resolution
```javascript
function determineInpaintingResolution(segment, originalResolution) {
    const segmentSize = segment.pixelCount / totalPixels;
    
    if (segmentSize < 0.1) {
        // Small segment - lower resolution OK
        return Math.min(512, originalResolution);
    } else if (segmentSize < 0.3) {
        // Medium segment
        return Math.min(1024, originalResolution);
    } else {
        // Large segment - need full quality
        return Math.min(2048, originalResolution);
    }
}
```

## Optimizations

### Caching Strategy
- Cache segmentation results
- Cache inpainted backgrounds
- Reuse for similar viewpoints

### Progressive Loading
1. Show stretched version immediately
2. Load inpainted backgrounds progressively
3. Swap in as they become available

### Smart Inpainting
- Only inpaint visible regions + buffer
- Skip fully occluded areas
- Use depth-aware prompts for better results

## API Integration

### LaMa via Replicate
```javascript
async function inpaintWithLaMa(image, mask) {
    const response = await fetch('https://api.replicate.com/v1/predictions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${REPLICATE_API_TOKEN}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            version: 'twn39/lama:...',
            input: {
                image: await uploadImage(image),
                mask: await uploadMask(mask)
            }
        })
    });
    
    return await downloadResult(response);
}
```

## Architecture: TieflingGenerate Class

### Purpose
A new preprocessing class that handles all generation steps and outputs a single bundle file containing everything needed for rendering.

### Command Line Interface
```bash
# Basic usage
tiefling-generate input.jpg output.tiefling

# With options
tiefling-generate input.jpg output.tiefling \
  --depth-model="depth-pro" \
  --max-segments=10 \
  --min-discontinuity=0.1 \
  --inpaint-resolution=1024 \
  --inpaint-provider="replicate"

# With custom depth map
tiefling-generate input.jpg output.tiefling \
  --depth-map=custom_depth.png
```

### Class Structure
```javascript
class TieflingGenerate {
    constructor(config = {}) {
        this.config = {
            depth: {
                model: 'depth-pro', // or 'depth-anything-v2'
                resolution: 1536
            },
            segmentation: {
                minDiscontinuity: 0.1,
                maxSegments: 10,
                mergeThreshold: 0.05
            },
            inpainting: {
                provider: 'replicate', // or 'local'
                resolution: 1024,
                dilationRadius: 50
            },
            output: {
                format: 'tiefling', // custom bundle format
                compression: 'zstd' // or 'gzip', 'none'
            },
            ...config
        };
    }

    async generate(imagePath, outputPath, options = {}) {
        // 1. Load image
        const image = await this.loadImage(imagePath);
        
        // 2. Generate or load depth map
        const depthMap = options.depthMap ? 
            await this.loadDepthMap(options.depthMap) :
            await this.generateDepthMap(image);
        
        // 3. Segment depth map
        const segments = await this.segmentDepthMap(depthMap);
        
        // 4. Progressive inpainting
        const backgrounds = await this.createBackgrounds(image, segments, depthMap);
        
        // 5. Generate meshes
        const meshes = await this.generateMeshes(image, depthMap, segments, backgrounds);
        
        // 6. Bundle everything
        const bundle = await this.createBundle({
            metadata: {
                version: '2.0',
                created: new Date().toISOString(),
                config: this.config
            },
            image: image,
            depthMap: depthMap,
            segments: segments,
            meshes: meshes,
            textures: {
                original: image,
                backgrounds: backgrounds
            }
        });
        
        // 7. Save bundle
        await this.saveBundle(bundle, outputPath);
        
        return bundle;
    }
    
    // ... individual methods for each step ...
}
```

### Bundle File Format (.tiefling)

A single file containing all assets needed for rendering:

```javascript
// Bundle structure (JSON + binary data)
{
    "version": "1.0",
    "metadata": {
        "created": "2024-01-01T00:00:00Z",
        "generator": "TieflingGenerate",
        "config": { /* generation config */ }
    },
    "assets": {
        "image": {
            "format": "jpeg",
            "resolution": [3840, 2160],
            "dataOffset": 0,
            "dataLength": 2048576
        },
        "depthMap": {
            "format": "png",
            "resolution": [1536, 864],
            "dataOffset": 2048576,
            "dataLength": 524288
        },
        "segments": {
            "count": 5,
            "data": [ /* segment definitions */ ]
        },
        "meshes": [
            {
                "segmentId": 0,
                "vertexCount": 10000,
                "strategy": "stretch",
                "dataOffset": 2572864,
                "dataLength": 240000
            },
            {
                "segmentId": 1,
                "vertexCount": 12000,
                "strategy": "inpaint",
                "backgroundTextureId": "bg_1",
                "dataOffset": 2812864,
                "dataLength": 288000
            }
            // ... more meshes
        ],
        "textures": {
            "bg_1": {
                "format": "jpeg",
                "resolution": [1024, 1024],
                "dataOffset": 3100864,
                "dataLength": 204800
            }
            // ... more textures
        }
    },
    "binaryData": "base64..." // or separate binary section
}
```

### File Format Options

#### Option A: ZIP-based Bundle (preferred)
```
output.tiefling (zip file)
├── manifest.json
├── original.jpg
├── depth.png
├── segments.json
├── meshes/
│   ├── mesh_0.obj
│   ├── mesh_1.obj
│   └── ...
└── textures/
    ├── background_1.jpg
    ├── background_2.jpg
    └── ...
```

#### Option B: Custom Binary Format
```
[Header - 256 bytes]
[Metadata - JSON]
[Asset Table]
[Binary Data - images, meshes, etc.]
```

#### Option C: MessagePack or Protocol Buffers
More efficient than JSON, with schema definition.

### Updated TieflingView

```javascript
export const TieflingView = function(container, bundlePath, options) {
    // New: Load from bundle instead of separate image/depth
    const bundle = await loadBundle(bundlePath);
    
    // Extract assets
    const {
        image,
        depthMap,
        segments,
        meshes,
        textures
    } = bundle.assets;
    
    // Initialize renderer with pre-generated meshes
    initRenderer(container, meshes, textures, options);
    
    // No mesh generation needed - just render!
    animate();
}
```

## Next Steps

1. **Implement TieflingGenerate class**
   - Create command-line interface
   - Implement core generation pipeline
   - Design and implement bundle format

2. **Test with various images**
   - Simple portraits
   - Complex crowds
   - Nature scenes
   - Validate segmentation quality

3. **Update TieflingView**
   - Add bundle loading support
   - Remove mesh generation code
   - Support multi-mesh rendering

4. **Optimize bundle format**
   - Test compression options
   - Benchmark loading times
   - Consider streaming for large files

5. **Create development tools**
   - Bundle inspector/viewer
   - Segmentation visualizer
   - Debug mode for TieflingView

## Success Metrics

- **Segmentation Quality**: Correctly identifies 90%+ of significant depth edges
- **Inpainting Quality**: No visible artifacts at segment boundaries
- **Performance**: < 5 minutes for 10-layer scene
- **Memory Usage**: Reasonable for M1 Pro Mac (< 8GB for process)
- **Visual Quality**: No stretched pixels at depth > 0.15 discontinuities

## Open Questions

1. Should we use different inpainting models for different types of content (nature vs urban)?
2. How to handle semi-transparent objects (glass, fog)?
3. Should segmentation parameters auto-adjust based on scene complexity?
4. Can we predict optimal segment count from depth histogram?

## Alternative Approaches to Consider

- **Depth-conditioned diffusion models**: For depth-aware inpainting
- **Optical flow-based inpainting**: Leverage motion priors
- **Learning-based segmentation**: Train model to predict optimal segments
- **Hybrid 2D/3D**: Use actual 3D reconstruction for some segments