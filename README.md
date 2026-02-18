# visage3d

**3D face rendering for AI agents. Turns facial motion data into real-time 3D animation.**

Consumes MocapFrame data (from [agentface](https://github.com/tjamescouch/agentface)) and renders a 3D animated face with:
- Head and jaw motion
- Eye gaze and blinking
- Facial expression blending
- Real-time morphtarget animation

Built on Three.js for web-based rendering.

## Purpose

While `agentface` produces motion data and `visage` renders 2D emoji/vector faces, visage3d provides **high-fidelity 3D face animation** for agents that want photorealistic or stylized avatars.

```
MocapFrame stream (from agentface)
    ↓
VisageViewer (Three.js)
    ↓
3D animated face (WebGL)
```

## Features

- **Real-time morphtargets** — Blend shapes for expressions (happy, sad, angry, etc.)
- **Head and jaw motion** — Quaternion-based skeletal animation
- **Eye gaze and blink** — Separate controls for each eye
- **Asset management** — Load 3D models, textures, blend shapes
- **Web-based** — Renders to WebGL canvas, no external dependencies beyond Three.js

## Installation

```bash
npm install visage3d
```

## Usage

### Basic Setup

```javascript
import { VisageViewer } from 'visage3d';

// Create a viewer in a canvas element
const viewer = new VisageViewer({
  container: document.getElementById('face-container'),
  modelPath: '/models/face.glb',  // GLTF model with blend shapes
  width: 800,
  height: 600
});

// Load assets
await viewer.loadModel();

// Subscribe to animation loop
viewer.onFrame((frame) => {
  console.log('Rendering frame', frame);
});

// Start rendering
viewer.start();
```

### Consuming MocapFrames

```javascript
import { VisageViewer } from 'visage3d';
import { Agentface } from 'agentface';

const viewer = new VisageViewer(options);
const agentface = new Agentface();

// Stream mocap data to the viewer
agentface.onFrame((mocapFrame) => {
  viewer.updateFrame(mocapFrame);
});

// Pipe LLM tokens to agentface
llm.onToken(token => {
  agentface.processTokens(token);
});
```

## API

### `new VisageViewer(options)`

Create a new 3D face viewer.

**Options:**

- `container` — DOM element or selector for the canvas
- `modelPath` — URL to GLTF model (with blend shapes)
- `width` (default: 800) — Canvas width
- `height` (default: 600) — Canvas height
- `camera` — Camera configuration
  - `position` — [x, y, z] position (default: [0, 0, 2])
  - `fov` — Field of view (default: 50)
- `lighting` — Lighting setup
  - `ambient` — Ambient light intensity (default: 1.0)
  - `directional` — Key light intensity (default: 1.0)

### `viewer.loadModel()`

Load the 3D model from the `modelPath`. The model should be a GLTF file with:
- Skeleton (armature) for jaw and head
- Blend shapes for expressions (happy, sad, angry, surprised, thinking, calm, neutral)
- Textures and materials

Returns a Promise.

### `viewer.updateFrame(mocapFrame)`

Apply a MocapFrame to the current face state. Updates:
- Head quaternion
- Jaw rotation and openness
- Eye gaze and blink for each eye
- Expression blend weights

### `viewer.start()`

Start the render loop. Continuous animation updates at 60fps (or monitor refresh rate).

### `viewer.stop()`

Stop rendering.

### `viewer.reset()`

Return face to neutral pose (head straight, eyes forward, no blinking, neutral expression).

### `viewer.onFrame(callback)`

Register a callback called on each render frame. Useful for debugging or logging.

## 3D Model Requirements

Visage3d expects a GLTF model with:

```
Model
├── Skeleton
│   ├── Head (bone)
│   │   └── Jaw (child bone)
│   └── LeftEye, RightEye (bones or targets)
├── Mesh (with materials)
├── Blend Shapes:
│   ├── Happy
│   ├── Sad
│   ├── Angry
│   ├── Surprised
│   ├── Thinking
│   ├── Calm
│   └── Neutral
```

You can create models in:
- **Blender** — Model the face, rig with armature, add blend shapes (shapekeys), export as GLTF
- **Maya** — Rig and export GLTF with blend shapes
- **Mixamo** — Download rigged models and customize

## Asset Management

Visage3d includes an `AssetManager` for loading and caching resources:

```javascript
import { AssetManager } from 'visage3d';

const assetMgr = new AssetManager();

// Register an asset
assetMgr.register({
  id: 'face-model',
  type: 'model',
  url: '/models/face.glb'
});

// Load it
const model = await assetMgr.load('face-model');

// Or preload all
await assetMgr.preloadAll();
```

## Performance

- **60fps target** — Optimized for smooth real-time animation
- **Morphtarget blending** — GPU-accelerated (WebGL)
- **Bone animations** — Quaternion-based skeletal animation
- **Asset caching** — Models and textures cached after first load

## Examples

See `examples/` for:
- `basic.html` — Minimal setup, static frame
- `stream.html` — Consume live MocapFrames from agentface
- `interactive.html` — Manual controls for testing expressions and poses

## Development

```bash
npm install
npm run dev        # Start dev server (Vite)
npm run build      # Build for production
npm run typecheck  # Type check
```

## Browser Support

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

(Requires WebGL 2 support.)

## See Also

- [agentface](https://github.com/tjamescouch/agentface) — Token stream → motion data
- [visage](https://github.com/tjamescouch/visage) — 2D/vector face renderer
- [Three.js](https://threejs.org) — 3D graphics library
- [GLTF Spec](https://www.khronos.org/gltf/) — 3D model format

## License

MIT
