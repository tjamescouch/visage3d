import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export interface VisageViewerOptions {
  /** Container element to mount into */
  container: HTMLElement;
  /** URL or path to the .glb model */
  modelUrl: string;
  /** Background color (default: 0x1a1a2e) */
  backgroundColor?: number;
  /** Enable orbit controls (default: true) */
  orbitControls?: boolean;
  /** Auto-play first animation (default: true) */
  autoPlay?: boolean;
  /** Device pixel ratio (default: window.devicePixelRatio) */
  pixelRatio?: number;
  /** Show fallback silhouette on load failure (default: true) */
  fallback?: boolean;
}

/** Map of morph target name → influence value (0..1) */
export type MorphTargetMap = Record<string, number>;

/**
 * VisageViewer — renders a GLB avatar model with animation support
 * and emotion-driven morph target (blend shape) control.
 *
 * Designed as a standalone, reusable component. Mount it in any container element.
 * Handles its own resize observer, render loop, and cleanup.
 */
export class VisageViewer {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private clock = new THREE.Clock();
  private animationId: number | null = null;
  private resizeObserver: ResizeObserver;
  private container: HTMLElement;
  private disposed = false;
  private fallbackGroup: THREE.Group | null = null;
  private modelLoaded = false;

  private animations: THREE.AnimationClip[] = [];
  private activeAction: THREE.AnimationAction | null = null;

  /** All meshes with morph targets, discovered after load */
  private morphMeshes: THREE.Mesh[] = [];

  constructor(private opts: VisageViewerOptions) {
    this.container = opts.container;

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(opts.pixelRatio ?? window.devicePixelRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(opts.backgroundColor ?? 0x1a1a2e);

    // Camera
    const aspect = this.container.clientWidth / (this.container.clientHeight || 1);
    this.camera = new THREE.PerspectiveCamera(35, aspect, 0.1, 100);
    this.camera.position.set(0, 1.4, 2.5);

    // Controls
    if (opts.orbitControls !== false) {
      this.controls = new OrbitControls(this.camera, this.renderer.domElement);
      this.controls.target.set(0, 1.0, 0);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.08;
      this.controls.minDistance = 0.5;
      this.controls.maxDistance = 10;
      this.controls.update();
    }

    // Lighting
    this.setupLighting();

    // Resize handling
    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(this.container);
    this.onResize();
  }

  private setupLighting(): void {
    // Ambient
    const ambient = new THREE.AmbientLight(0xffffff, 0.4);
    this.scene.add(ambient);

    // Key light (warm, from upper-right)
    const key = new THREE.DirectionalLight(0xfff5e6, 1.2);
    key.position.set(2, 3, 2);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    this.scene.add(key);

    // Fill light (cool, from left)
    const fill = new THREE.DirectionalLight(0xe6f0ff, 0.5);
    fill.position.set(-2, 2, 1);
    this.scene.add(fill);

    // Rim light (from behind)
    const rim = new THREE.DirectionalLight(0xffffff, 0.3);
    rim.position.set(0, 2, -3);
    this.scene.add(rim);
  }

  /**
   * Build a fallback silhouette (sphere head + cylinder body)
   * shown when the GLB model fails to load.
   */
  private buildFallback(): THREE.Group {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color: 0x303050,
      roughness: 0.8,
      metalness: 0.1,
    });

    // Head
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 32, 24), mat);
    head.position.set(0, 1.55, 0);
    group.add(head);

    // Neck
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.1, 16), mat);
    neck.position.set(0, 1.35, 0);
    group.add(neck);

    // Torso
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.5, 16), mat);
    torso.position.set(0, 1.05, 0);
    group.add(torso);

    // Lower body
    const lower = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.15, 0.4, 16), mat);
    lower.position.set(0, 0.6, 0);
    group.add(lower);

    return group;
  }

  /** Load the GLB model and optionally start animation */
  async load(): Promise<void> {
    const loader = new GLTFLoader();

    try {
      const gltf: GLTF = await new Promise((resolve, reject) => {
        loader.load(this.opts.modelUrl, resolve, undefined, reject);
      });

      // Remove fallback if present
      if (this.fallbackGroup) {
        this.scene.remove(this.fallbackGroup);
        this.fallbackGroup = null;
      }

      this.scene.add(gltf.scene);
      this.modelLoaded = true;

      // Discover all meshes with morph targets
      this.morphMeshes = [];
      gltf.scene.traverse((child) => {
        if (
          child instanceof THREE.Mesh &&
          child.morphTargetInfluences &&
          child.morphTargetDictionary
        ) {
          this.morphMeshes.push(child);
        }
      });

      // Store animations
      this.animations = gltf.animations;

      if (this.animations.length > 0) {
        this.mixer = new THREE.AnimationMixer(gltf.scene);

        if (this.opts.autoPlay !== false) {
          this.playAnimation(0);
        }
      }
    } catch (err) {
      console.warn("visage3d: model load failed, showing fallback", err);

      if (this.opts.fallback !== false) {
        this.fallbackGroup = this.buildFallback();
        this.scene.add(this.fallbackGroup);
      } else {
        throw err;
      }
    }

    // Start render loop regardless
    this.startRenderLoop();
  }

  /** Play animation by index */
  playAnimation(index: number): void {
    if (!this.mixer || index < 0 || index >= this.animations.length) return;

    if (this.activeAction) {
      this.activeAction.fadeOut(0.3);
    }

    const clip = this.animations[index];
    const action = this.mixer.clipAction(clip);
    action.reset().fadeIn(0.3).play();
    this.activeAction = action;
  }

  /** Get list of available animation names */
  getAnimationNames(): string[] {
    return this.animations.map((c) => c.name);
  }

  // --- Morph Target API ---

  /**
   * Get all discovered morph target names across all meshes.
   * Returns a deduplicated sorted array.
   */
  getMorphTargetNames(): string[] {
    const names = new Set<string>();
    for (const mesh of this.morphMeshes) {
      if (mesh.morphTargetDictionary) {
        for (const name of Object.keys(mesh.morphTargetDictionary)) {
          names.add(name);
        }
      }
    }
    return Array.from(names).sort();
  }

  /**
   * Set morph target influences by name.
   * Unknown names are silently skipped.
   * Values are clamped to [0, 1].
   *
   * @example
   * viewer.setMorphTargets({ "mouthSmile": 0.8, "eyeSquintLeft": 0.3 });
   */
  setMorphTargets(targets: MorphTargetMap): void {
    for (const mesh of this.morphMeshes) {
      const dict = mesh.morphTargetDictionary;
      const influences = mesh.morphTargetInfluences;
      if (!dict || !influences) continue;

      for (const [name, value] of Object.entries(targets)) {
        const idx = dict[name];
        if (idx !== undefined) {
          influences[idx] = Math.max(0, Math.min(1, value));
        }
      }
    }
  }

  /**
   * Get current morph target influences as a map.
   * Returns all targets with their current values.
   */
  getMorphTargets(): MorphTargetMap {
    const result: MorphTargetMap = {};
    for (const mesh of this.morphMeshes) {
      const dict = mesh.morphTargetDictionary;
      const influences = mesh.morphTargetInfluences;
      if (!dict || !influences) continue;

      for (const [name, idx] of Object.entries(dict)) {
        // Last mesh wins if there are duplicates — fine for typical avatars
        result[name] = influences[idx] ?? 0;
      }
    }
    return result;
  }

  /**
   * Reset all morph targets to 0.
   */
  resetMorphTargets(): void {
    for (const mesh of this.morphMeshes) {
      if (mesh.morphTargetInfluences) {
        mesh.morphTargetInfluences.fill(0);
      }
    }
  }

  /** Whether the 3D model loaded successfully (vs fallback) */
  get loaded(): boolean {
    return this.modelLoaded;
  }

  private startRenderLoop(): void {
    if (this.disposed) return;

    const render = () => {
      if (this.disposed) return;
      this.animationId = requestAnimationFrame(render);

      const delta = this.clock.getDelta();
      this.mixer?.update(delta);
      this.controls?.update();
      this.renderer.render(this.scene, this.camera);
    };

    render();
  }

  private onResize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight || 1;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  /** Clean up all resources */
  dispose(): void {
    this.disposed = true;

    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
    }

    this.resizeObserver.disconnect();
    this.controls?.dispose();
    this.mixer?.stopAllAction();
    this.renderer.dispose();

    // Remove canvas from DOM
    if (this.renderer.domElement.parentElement) {
      this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
    }
  }
}
