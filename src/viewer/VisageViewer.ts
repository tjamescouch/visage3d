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
  /** Show fallback silhouette if model fails to load (default: true) */
  showFallback?: boolean;
}

export type LoadResult =
  | { ok: true; animations: string[]; morphTargets: string[] }
  | { ok: false; error: Error; fallback: true };

/**
 * VisageViewer — renders a GLB avatar model with animation + morph target support.
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

  private animations: THREE.AnimationClip[] = [];
  private activeAction: THREE.AnimationAction | null = null;

  /** All meshes with morph targets, keyed by morph target name → {mesh, index} */
  private morphTargetMap = new Map<string, { mesh: THREE.Mesh; index: number }[]>();

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
    const ambient = new THREE.AmbientLight(0xffffff, 0.4);
    this.scene.add(ambient);

    const key = new THREE.DirectionalLight(0xfff5e6, 1.2);
    key.position.set(2, 3, 2);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0xe6f0ff, 0.5);
    fill.position.set(-2, 2, 1);
    this.scene.add(fill);

    const rim = new THREE.DirectionalLight(0xffffff, 0.3);
    rim.position.set(0, 2, -3);
    this.scene.add(rim);
  }

  /**
   * Load the GLB model. Returns info about available animations and morph targets.
   * On failure, shows a fallback silhouette if opts.showFallback is true.
   */
  async load(): Promise<LoadResult> {
    const loader = new GLTFLoader();

    try {
      const gltf: GLTF = await new Promise((resolve, reject) => {
        loader.load(this.opts.modelUrl, resolve, undefined, reject);
      });

      this.scene.add(gltf.scene);

      // Index morph targets
      this.indexMorphTargets(gltf.scene);

      // Store animations
      this.animations = gltf.animations;

      if (this.animations.length > 0) {
        this.mixer = new THREE.AnimationMixer(gltf.scene);
        if (this.opts.autoPlay !== false) {
          this.playAnimation(0);
        }
      }

      this.startRenderLoop();

      return {
        ok: true,
        animations: this.animations.map((c) => c.name),
        morphTargets: Array.from(this.morphTargetMap.keys()),
      };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));

      if (this.opts.showFallback !== false) {
        this.showFallbackSilhouette();
        this.startRenderLoop();
      }

      return { ok: false, error, fallback: true };
    }
  }

  /** Display a simple head silhouette as fallback */
  private showFallbackSilhouette(): void {
    // Simple sphere head + cylinder neck
    const headGeo = new THREE.SphereGeometry(0.15, 32, 24);
    const neckGeo = new THREE.CylinderGeometry(0.06, 0.08, 0.1, 16);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x404060,
      roughness: 0.8,
      metalness: 0.1,
    });

    const head = new THREE.Mesh(headGeo, mat);
    head.position.set(0, 1.55, 0);
    this.scene.add(head);

    const neck = new THREE.Mesh(neckGeo, mat);
    neck.position.set(0, 1.35, 0);
    this.scene.add(neck);
  }

  /** Walk the scene graph and index all morph targets by name */
  private indexMorphTargets(root: THREE.Object3D): void {
    root.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const geo = child.geometry;
      if (!geo.morphAttributes || !child.morphTargetDictionary) return;

      for (const [name, index] of Object.entries(child.morphTargetDictionary)) {
        const existing = this.morphTargetMap.get(name) ?? [];
        existing.push({ mesh: child, index });
        this.morphTargetMap.set(name, existing);
      }
    });
  }

  /**
   * Set morph target influences by name.
   * Values are 0..1. Unknown names are silently ignored.
   */
  setMorphTargets(targets: Record<string, number>): void {
    for (const [name, value] of Object.entries(targets)) {
      const entries = this.morphTargetMap.get(name);
      if (!entries) continue;

      const clamped = Math.max(0, Math.min(1, value));
      for (const { mesh, index } of entries) {
        if (mesh.morphTargetInfluences) {
          mesh.morphTargetInfluences[index] = clamped;
        }
      }
    }
  }

  /** Get all available morph target names */
  getMorphTargetNames(): string[] {
    return Array.from(this.morphTargetMap.keys());
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

    if (this.renderer.domElement.parentElement) {
      this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
    }
  }
}
