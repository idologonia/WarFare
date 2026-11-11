import { ArcRotateCamera, Color3, Color4, DirectionalLight, Engine, HemisphericLight, Scene, TransformNode, Vector3 } from '@/rendering/babylon';

/**
 * Невеликий 3D-переглядач для екрана спорядження (окремий рушій і сцена):
 * повільне обертання, перетягування мишею/пальцем, колесо — масштаб.
 */
export class Preview3D {
  readonly canvas: HTMLCanvasElement;
  engine: Engine;
  scene: Scene;
  camera: ArcRotateCamera;
  root: TransformNode;
  private spin = true;

  constructor(width: number, height: number, radius: number, target = new Vector3(0, 0, 0)) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'preview3d';
    this.canvas.width = width;
    this.canvas.height = height;
    this.canvas.style.touchAction = 'none';
    this.engine = new Engine(this.canvas, true, { preserveDrawingBuffer: true }, true);
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.13, 0.15, 0.17, 1);
    this.camera = new ArcRotateCamera('pcam', -Math.PI / 2.4, 1.2, radius, target, this.scene);
    this.camera.lowerRadiusLimit = radius * 0.4;
    this.camera.upperRadiusLimit = radius * 2;
    this.camera.wheelPrecision = 80;
    this.camera.minZ = 0.01;
    this.camera.attachControl(this.canvas, true);
    const hemi = new HemisphericLight('ph', new Vector3(0.3, 1, -0.4), this.scene);
    hemi.intensity = 1.05;
    hemi.groundColor = new Color3(0.25, 0.25, 0.3);
    const sun = new DirectionalLight('ps', new Vector3(-0.6, -1, 0.5), this.scene);
    sun.intensity = 1.0;
    const fill = new DirectionalLight('pf', new Vector3(0.7, -0.3, -0.6), this.scene);
    fill.intensity = 0.45;
    this.root = new TransformNode('proot', this.scene);
    this.canvas.addEventListener('pointerdown', () => (this.spin = false));
    this.scene.onBeforeRenderObservable.add(() => {
      if (this.spin) this.camera.alpha += 0.004;
    });
    this.engine.runRenderLoop(() => this.scene.render());
  }

  /** Замінити вміст сцени (корінь очищується). */
  setContent(build: (scene: Scene, root: TransformNode) => void): void {
    for (const c of this.root.getChildren()) c.dispose();
    build(this.scene, this.root);
  }

  dispose(): void {
    this.engine.stopRenderLoop();
    this.scene.dispose();
    this.engine.dispose();
  }
}
