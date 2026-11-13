import { cellKey, type Cell } from '@/core/grid';
import { cellAt, groundHeight } from '@/game/maps/map';
import type { MissionState, SimEvent } from '@/game/simulation/state';
import { sideSees } from '@/game/visibility/visibility';
import type { Point } from '@/game/visibility/los';
import type { DroneState, SideId, Unit, VehicleState } from '@/game/types';
import {
  ArcRotateCamera,
  Camera,
  Color3,
  Color4,
  CreateCylinder,
  CreateSphere,
  CreateTorus,
  DirectionalLight,
  Engine,
  HemisphericLight,
  PointLight,
  DefaultRenderingPipeline,
  ImageProcessingConfiguration,
  Matrix,
  Scene,
  ShadowGenerator,
  Vector3,
  type AbstractEngine,
  type Mesh,
  type StandardMaterial,
} from './babylon';
import { Animator, ease, lerp } from './anim';
import { GeoBuilder, hash2, hex, type RGB } from './geo';
import { LH, MapView, cellWorld, makeMaterial, world } from './mapView';
import { applyPose, buildUnitModel, SIDE_COLOR, type UnitModel } from './unitView';
import { buildVehicleModel, facingAngle, type VehicleModel } from './vehicleView';
import { buildDroneModel, type DroneModel } from './droneView';
import { engineSfx, sfx, vehicleDestroyedSfx, vehicleGunSfx, type Sfx } from './sound';
import { content, itemDef } from '@/content';
import type { WeaponDefinition } from '@/game/types';
import { visibleCells } from '@/game/visibility/visibility';
import { facingOf, facingRotation } from '@/game/units/facing';
import { droneAltitude, droneNoticedBy } from '@/game/drones';
import { vehicleDef } from '@/content';
import { vehicleSeenBy } from '@/game/visibility/visibility';
import { camoFor, uniformAtlas, uniformTile } from './camo';
import { lookFor } from './uniform';

export interface GraphicsSettings {
  shadows: boolean;
  renderScale: number;
  engine: 'webgl' | 'webgpu';
  animSpeed: number;
  postfx?: boolean;
}

export interface OverlayCell {
  cell: Cell;
  color: RGB;
}

const pointWorld = (p: Point) => world(p.x, p.y, p.h);

/** Графічний адаптер: лише відображає стан і події симуляції. */
export class Renderer {
  engine!: AbstractEngine;
  scene!: Scene;
  camera!: ArcRotateCamera;
  anim!: Animator;
  map!: MapView;
  private shadowGen: ShadowGenerator | null = null;
  private light!: DirectionalLight;
  private hemi!: HemisphericLight;
  private beams = new Map<string, Mesh>();
  private beamMat!: StandardMaterial;
  private fireMat!: StandardMaterial;
  private pp: DefaultRenderingPipeline | null = null;
  private fireLights: PointLight[] = [];
  private units = new Map<string, UnitModel>();
  private unitMats: Record<string, StandardMaterial> = {};

  /** Атлас форми (усі бійці й техніка — один матеріал). */
  private sideMat(_side?: SideId): StandardMaterial {
    return (this.unitMats.atlas ??= uniformAtlas(this.scene));
  }

  /** Тайл основного камуфляжу фракції сторони (для техніки). */
  private sideTile(side: SideId): number {
    const fid = this.state?.scenario?.sides?.[side]?.factionId;
    return uniformTile(camoFor(content().factions.find((f) => f.id === fid)?.camo, side));
  }

  private lookOf(u: Unit) {
    return lookFor(u, this.state?.scenario?.sides?.[u.side]?.factionId, u.side);
  }
  private silhouetteMat!: StandardMaterial;
  private overlayMat!: StandardMaterial;
  private fxMat!: StandardMaterial;
  private overlays = new Map<string, Mesh>();
  private selRing!: Mesh;
  private zoom = 6.5;
  viewLevel = 0;
  viewSide: SideId = 'blue';
  private state!: MissionState;
  onFrame: (() => void) | null = null;

  constructor(private canvas: HTMLCanvasElement, private gfx: GraphicsSettings) {}

  async init(): Promise<void> {
    if (this.gfx.engine === 'webgpu' && 'gpu' in navigator) {
      try {
        const { WebGPUEngine } = await import('@babylonjs/core/Engines/webgpuEngine');
        const e = new WebGPUEngine(this.canvas, { antialias: true, adaptToDeviceRatio: true });
        await e.initAsync();
        this.engine = e;
      } catch (err) {
        console.warn('WebGPU недоступний, використовуємо WebGL2', err);
      }
    }
    if (!this.engine) this.engine = new Engine(this.canvas, true, { preserveDrawingBuffer: true, stencil: true }, true);
    this.engine.setHardwareScalingLevel(this.gfx.renderScale / Math.min(2, window.devicePixelRatio || 1));
    const scene = (this.scene = new Scene(this.engine));
    scene.skipPointerMovePicking = true;
    scene.autoClearDepthAndStencil = true;
    scene.clearColor = new Color4(0.07, 0.08, 0.1, 1);
    scene.ambientColor = new Color3(0.3, 0.3, 0.3);
    this.anim = new Animator(scene);
    // Обробка кольору: трохи контрасту, експозиції й віньєтка.
    const ip = scene.imageProcessingConfiguration;
    ip.contrast = 1.18;
    ip.exposure = 1.06;
    ip.vignetteEnabled = true;
    ip.vignetteWeight = 1.6;
    ip.vignetteStretch = 0.4;
    this.anim.speed = this.gfx.animSpeed;

    const cam = (this.camera = new ArcRotateCamera('cam', this.alphaFor(0), 0.92, 60, Vector3.Zero(), scene));
    if (this.gfx.postfx !== false) {
      // Пост-обробка: згладжування, світіння яскравого (вогонь, спалахи, ліхтарі), кінотонування.
      const pp = (this.pp = new DefaultRenderingPipeline('pp', true, scene, [cam]));
      pp.fxaaEnabled = true;
      pp.bloomEnabled = true;
      pp.bloomThreshold = 0.82;
      pp.bloomWeight = 0.45;
      pp.bloomKernel = 48;
      pp.bloomScale = 0.5;
      pp.sharpenEnabled = true;
      pp.sharpen.edgeAmount = 0.25;
      pp.imageProcessingEnabled = true;
      pp.imageProcessing.toneMappingEnabled = true;
      pp.imageProcessing.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
      pp.imageProcessing.exposure = 1.25;
      pp.imageProcessing.contrast = 1.15;
      pp.imageProcessing.vignetteEnabled = true;
      pp.imageProcessing.vignetteWeight = 1.4;
    }
    cam.mode = Camera.ORTHOGRAPHIC_CAMERA;
    cam.minZ = 0.1;
    cam.maxZ = 400;

    const hemi = (this.hemi = new HemisphericLight('hemi', new Vector3(0.2, 1, -0.3), scene));
    hemi.intensity = 0.62;
    hemi.groundColor = new Color3(0.32, 0.3, 0.36);
    this.light = new DirectionalLight('sun', new Vector3(-0.55, -1, 0.4), scene);
    this.light.intensity = 0.85;
    this.light.position = new Vector3(30, 40, -10);
    this.setShadows(this.gfx.shadows);

    this.unitMats = {};
    this.silhouetteMat = makeMaterial(scene, 'silhouette');
    this.silhouetteMat.diffuseColor = new Color3(0.15, 0.15, 0.17);
    this.silhouetteMat.emissiveColor = new Color3(0.12, 0.12, 0.14);
    this.overlayMat = makeMaterial(scene, 'overlay', 0.5, true);
    this.fxMat = makeMaterial(scene, 'fx', 1, true);
    this.beamMat = makeMaterial(scene, 'beam', 0.16, true);
    this.beamMat.emissiveColor = new Color3(1, 0.95, 0.7);
    this.fireMat = makeMaterial(scene, 'fire', 1, true);

    this.selRing = CreateTorus('sel', { diameter: 0.8, thickness: 0.05, tessellation: 24 }, scene);
    const ringMat = makeMaterial(scene, 'ring', 1, true);
    ringMat.emissiveColor = new Color3(1, 0.85, 0.2);
    this.selRing.material = ringMat;
    this.selRing.isPickable = false;
    this.selRing.setEnabled(false);

    scene.onBeforeRenderObservable.add(() => {
      this.applyKeys(Math.min(50, this.engine.getDeltaTime()));
      this.spinRotors();
      this.updateOrtho();
      if (this.selRing.isEnabled()) this.selRing.rotation.y += 0.02;
      if (this.shadowGen && (this.shadowsDirty || this.anim.busy || this.camMoved())) {
        this.shadowGen.getShadowMap()!.resetRefreshCounter();
        this.shadowsDirty = false;
      }
      const fm = this.overlays.get('fire');
      if (fm) {
        const t = performance.now() / 120;
        fm.scaling.y = 1 + Math.sin(t) * 0.08 + Math.sin(t * 2.3) * 0.05;
        for (const l of this.fireLights) l.intensity = l.metadata.base * (0.85 + Math.random() * 0.3);
      }
    });
    this.engine.runRenderLoop(() => {
      scene.render();
      this.onFrame?.();
    });
    window.addEventListener('resize', () => this.engine.resize());
  }

  setShadows(on: boolean): void {
    this.gfx.shadows = on;
    if (on && !this.shadowGen) {
      this.shadowGen = new ShadowGenerator(2048, this.light);
      this.shadowGen.usePercentageCloserFiltering = true;
      this.shadowGen.filteringQuality = ShadowGenerator.QUALITY_HIGH;
      this.shadowGen.bias = 0.002;
      this.shadowGen.darkness = 0.35;
      this.shadowGen.getShadowMap()!.refreshRate = 0; // RENDER_ONCE; оновлюємо вручну
      this.shadowsDirty = true;
      for (const m of this.scene.meshes) if (m.metadata?.caster) this.shadowGen.addShadowCaster(m);
      for (const m of this.scene.meshes) if (m.metadata?.receiver) m.receiveShadows = true;
    } else if (!on && this.shadowGen) {
      this.shadowGen.dispose();
      this.shadowGen = null;
    }
  }

  setRenderScale(scale: number): void {
    this.gfx.renderScale = scale;
    this.engine.setHardwareScalingLevel(scale / Math.min(2, window.devicePixelRatio || 1));
  }

  private registerMesh = (m: Mesh, receive: boolean) => {
    m.metadata = { ...(m.metadata ?? {}), caster: !receive, receiver: true };
    m.receiveShadows = true;
    if (!receive && this.shadowGen) this.shadowGen.addShadowCaster(m);
    // Карта нерухома: не перераховувати матриці й межі щокадру.
    m.freezeWorldMatrix();
    m.doNotSyncBoundingInfo = true;
    this.shadowsDirty = true;
  };

  /** Тіні перемальовуються лише коли щось змінилось (рух, анімація, руйнування). */
  private shadowsDirty = true;
  markShadows(): void {
    this.shadowsDirty = true;
  }

  // ---------- Камера ----------

  private alphaFor(rot: number): number {
    return -Math.PI / 4 - (rot * Math.PI) / 2 - Math.PI / 2;
  }

  private updateOrtho(): void {
    const c = this.camera;
    const aspect = this.engine.getRenderWidth() / Math.max(1, this.engine.getRenderHeight());
    c.orthoTop = this.zoom;
    c.orthoBottom = -this.zoom;
    c.orthoLeft = -this.zoom * aspect;
    c.orthoRight = this.zoom * aspect;
  }

  /** Плавний поворот кнопками (крок 45°). */
  rotate(dir: 1 | -1): void {
    const from = this.camera.alpha;
    const to = from - (dir * Math.PI) / 4;
    void this.anim.tween(260, (t) => (this.camera.alpha = lerp(from, to, ease(t))));
  }

  /** Довільне обертання й нахил камери (перетягування мишею або двома пальцями). */
  orbit(dx: number, dy: number): void {
    this.camera.alpha -= dx * 0.008;
    this.camera.beta = Math.max(0.4, Math.min(1.3, this.camera.beta - dy * 0.006));
  }

  /** Утримувані клавіші руху камери: напрямок у межах [-1, 1]. */
  keyMove = { x: 0, y: 0, rot: 0 };

  private applyKeys(dtMs: number): void {
    const k = this.keyMove;
    if (k.x || k.y) this.pan(-k.x * dtMs * 0.9, k.y * dtMs * 0.9);
    if (k.rot) this.camera.alpha -= k.rot * dtMs * 0.0025;
  }

  zoomBy(k: number): void {
    this.zoom = Math.max(3.5, Math.min(18, this.zoom * k));
  }

  /** Зсув камери в екранних пікселях. */
  pan(dx: number, dy: number): void {
    const c = this.camera;
    const scale = (2 * this.zoom) / this.engine.getRenderHeight() * this.engine.getHardwareScalingLevel();
    const fwd = c.target.subtract(c.position);
    fwd.y = 0;
    fwd.normalize();
    const right = Vector3.Cross(Vector3.Up(), fwd).normalize();
    const t = c.target.add(right.scale(-dx * scale)).add(fwd.scale((dy * scale) / Math.sin(c.beta)));
    const m = this.state.map;
    t.x = Math.max(0, Math.min(m.width, t.x));
    t.z = Math.max(-m.height, Math.min(0, t.z));
    c.target = t;
  }

  focus(c: Cell, animate = true): void {
    const to = cellWorld(c, c.z);
    const from = this.camera.target.clone();
    if (!animate) {
      this.camera.target = to;
      return;
    }
    void this.anim.tween(300, (t) => (this.camera.target = Vector3.Lerp(from, to, ease(t))));
  }

  setViewLevel(z: number): void {
    this.viewLevel = Math.max(0, Math.min(this.state.map.levels - 1, z));
    this.refreshVisibility();
  }

  // ---------- Стан ----------

  /** Повна побудова сцени для стану місії. */
  load(state: MissionState, viewSide: SideId, keepCamera = false): void {
    this.state = state;
    this.viewSide = viewSide;
    for (const u of this.units.values()) u.root.dispose();
    this.units.clear();
    this.beams.clear();
    for (const m of this.vehicleModels.values()) m.root.dispose();
    this.vehicleModels.clear();
    for (const m of this.droneModels.values()) m.root.dispose();
    this.droneModels.clear();
    for (const m of this.droneShadows.values()) m.dispose();
    this.droneShadows.clear();
    this.applyEnvironment(state);
    this.map?.dispose();
    for (const o of this.overlays.values()) o.dispose();
    this.overlays.clear();
    this.scars = [];
    this.map = new MapView(this.scene, state.map, this.registerMesh, state.scenario?.timeOfDay === 'night');
    if (!keepCamera) this.camera.target = world(state.map.width / 2, state.map.height * 0.7, 0);
    for (const u of state.units) this.ensureUnit(u);
    this.sync();
  }

  setState(state: MissionState): void {
    this.state = state;
  }

  private ensureUnit(u: Unit): UnitModel {
    let m = this.units.get(u.id);
    if (!m) {
      m = buildUnitModel(this.scene, this.sideMat(u.side), u, this.lookOf(u));
      for (const mesh of m.meshes) {
        mesh.receiveShadows = true;
        this.shadowGen?.addShadowCaster(mesh);
        mesh.metadata = { ...mesh.metadata, caster: true };
      }
      this.units.set(u.id, m);
    }
    return m;
  }

  /** Розміщення моделей за станом (без анімації), видимість противника. */
  sync(): void {
    const s = this.state;
    this.shadowsDirty = true;
    this.refreshFog();
    this.syncVehicles();
    this.syncDrones();
    for (const u of s.units) {
      const m = this.ensureUnit(u);
      const visible = u.pos !== null && (u.side === this.viewSide || sideSees(s, this.viewSide, u.id) || u.status === 'dead') && u.pos.z <= this.viewLevel;
      const seenEnemyDead = u.side !== this.viewSide && u.status !== 'active' && !!s.contacts[this.viewSide][u.id];
      m.root.setEnabled(visible || (seenEnemyDead && u.pos !== null && u.pos.z <= this.viewLevel));
      if (!u.pos) continue;
      m.root.position = cellWorld(u.pos, groundHeight(s.map, u.pos));
      m.root.rotation.y = facingRotation(facingOf(u));
      applyPose(m, u.stance, u.weaponState, u.status);
      this.updateBeam(u, m);
      const identified = u.side === this.viewSide || s.revealAll || s.contacts[this.viewSide][u.id]?.identified;
      for (const mesh of m.meshes) mesh.material = identified ? this.sideMat(u.side) : this.silhouetteMat;
    }
    this.refreshVisibility();
  }

  /** Освітлення й атмосфера за сценарієм: день/ніч, туман, дощ. */
  applyEnvironment(state: MissionState): void {
    const sc = state.scenario ?? ({} as MissionState['scenario']);
    const night = sc.timeOfDay === 'night';
    const scene = this.scene;
    this.hemi.intensity = night ? 0.2 : sc.weather === 'rain' ? 0.5 : 0.62;
    this.hemi.diffuse = night ? new Color3(0.45, 0.55, 0.85) : new Color3(0.86, 0.92, 1);
    this.hemi.groundColor = night ? new Color3(0.08, 0.08, 0.14) : new Color3(0.36, 0.33, 0.25);
    this.light.intensity = night ? 0.22 : sc.weather === 'rain' ? 0.55 : 0.85;
    if (this.pp) this.pp.imageProcessing.exposure = night ? 0.85 : 1.25;
    this.light.diffuse = night ? new Color3(0.6, 0.7, 1) : new Color3(1, 0.94, 0.82);
    scene.clearColor = night ? new Color4(0.02, 0.03, 0.06, 1) : sc.weather === 'fog' ? new Color4(0.55, 0.57, 0.6, 1) : new Color4(0.36, 0.43, 0.5, 1);
    if (sc.weather === 'fog' || sc.weather === 'rain') {
      scene.fogMode = Scene.FOGMODE_LINEAR;
      scene.fogColor = night ? new Color3(0.05, 0.06, 0.09) : sc.weather === 'fog' ? new Color3(0.62, 0.64, 0.66) : new Color3(0.35, 0.38, 0.42);
      scene.fogStart = sc.weather === 'fog' ? 48 : 58;
      scene.fogEnd = sc.weather === 'fog' ? 76 : 100;
    } else scene.fogMode = Scene.FOGMODE_NONE;
  }

  /** Промінь ліхтаря (уночі, якщо ліхтар увімкнено і бійця видно). */
  private updateBeam(u: Unit, m: UnitModel): void {
    const want = u.lightOn && this.state.scenario?.timeOfDay === 'night' && u.status === 'active';
    let beam = this.beams.get(u.id);
    if (!want) {
      beam?.setEnabled(false);
      return;
    }
    if (!beam) {
      beam = CreateCylinder('beam', { height: 3.2, diameterTop: 1.6, diameterBottom: 0.08, tessellation: 12 }, this.scene);
      beam.material = this.beamMat;
      beam.isPickable = false;
      beam.rotation.x = Math.PI / 2;
      beam.position.set(0, 0.95, 1.75);
      beam.parent = m.root;
      this.beams.set(u.id, beam);
    }
    beam.setEnabled(true);
  }

  /** Полум'я в клітинках, що горять; уночі — кілька точкових джерел світла. */
  refreshFire(): void {
    this.overlays.get('fire')?.dispose();
    this.overlays.delete('fire');
    for (const l of this.fireLights) l.dispose();
    this.fireLights = [];
    const m = this.state.map;
    const g = new GeoBuilder();
    const cells: { x: number; y: number; z: number }[] = [];
    m.cells.forEach((lvl, z) =>
      lvl.forEach((row, y) =>
        row.forEach((c, x) => {
          if (!c.fire || z > this.viewLevel) return;
          cells.push({ x, y, z });
          const p = cellWorld({ x, y, z }, groundHeight(m, { x, y, z }));
          const k = Math.min(1, c.fire / 3);
          for (let i = 0; i < 5; i++) {
            const a = hash2(x, y, i) - 0.5;
            const b = hash2(y, x, i + 7) - 0.5;
            const hgt = (0.3 + hash2(x + i, y, 3) * 0.5) * (0.6 + 0.4 * k);
            g.box(p.x + a * 0.7, p.y + hgt / 2, p.z + b * 0.7, 0.22, hgt, 0.22, [1, 0.45 + hash2(i, x, y) * 0.2, 0.08], 0.9);
            g.box(p.x + a * 0.7, p.y + hgt * 0.35, p.z + b * 0.7, 0.12, hgt * 0.6, 0.12, [1, 0.9, 0.35], 0.95);
          }
          g.box(p.x, p.y + 0.015, p.z, 0.95, 0.02, 0.95, [0.16, 0.07, 0.03]); // згарище
        }),
      ),
    );
    if (g.empty) return;
    const mesh = g.build('ov_fire', this.scene, this.fireMat);
    mesh.isPickable = false;
    mesh.hasVertexAlpha = false;
    this.overlays.set('fire', mesh);
    if (this.state.scenario.timeOfDay === 'night') {
      // Не більше 3 джерел: центри скупчень вогню.
      const picks: { x: number; y: number; z: number }[] = [];
      for (const c of cells) if (picks.length < 3 && picks.every((q) => Math.hypot(q.x - c.x, q.y - c.y) > 4)) picks.push(c);
      for (const c of picks) {
        const l = new PointLight('fireLight', cellWorld(c, groundHeight(m, c) + 0.8), this.scene);
        l.diffuse = new Color3(1, 0.55, 0.2);
        l.range = 7;
        l.metadata = { base: 1.4 };
        l.intensity = 1.4;
        this.fireLights.push(l);
      }
    }
  }

  /** Димові завіси: напівпрозорі клуби в клітинках із димом. */
  refreshSmoke(): void {
    this.overlays.get('smoke')?.dispose();
    this.overlays.delete('smoke');
    const g = new GeoBuilder();
    const m = this.state.map;
    m.cells.forEach((lvl, z) =>
      lvl.forEach((row, y) =>
        row.forEach((c, x) => {
          if (!c.smoke || z > this.viewLevel) return;
          const p = cellWorld({ x, y, z }, groundHeight(m, { x, y, z }));
          const k = Math.min(1, c.smoke / 3);
          for (let i = 0; i < 3; i++) {
            const a = hash2(x, y, i);
            const b = hash2(y, x, i + 3);
            g.box(p.x + (a - 0.5) * 0.4, p.y + 0.35 + i * 0.4, p.z + (b - 0.5) * 0.4, 0.9 - i * 0.15, 0.55, 0.9 - i * 0.15, [0.78, 0.78, 0.76], 0.28 + 0.2 * k);
          }
        }),
      ),
    );
    if (g.empty) return;
    const mesh = g.build('ov_smoke', this.scene, this.overlayMat);
    mesh.isPickable = false;
    mesh.hasVertexAlpha = true;
    this.overlays.set('smoke', mesh);
  }

  private fogKey = '';

  /** Затемнення клітинок, яких не бачить жоден свій боєць (як у X-COM). */
  refreshFog(force = false): void {
    const s = this.state;
    const night = s?.scenario?.timeOfDay === 'night';
    if (!s?.map || (s.revealAll && !night) || s.turn.phase === 'deploy') {
      this.overlays.get('fog')?.dispose();
      this.overlays.delete('fog');
      this.fogKey = '';
      return;
    }
    const key =
      this.viewSide + this.viewLevel + '|' +
      s.units.filter((u) => u.side === this.viewSide && u.pos && u.status === 'active').map((u) => `${u.pos!.x},${u.pos!.y},${u.pos!.z},${u.facing},${u.stance},${u.lightOn ? 1 : 0},${u.nvgUp ? 1 : 0}`).join(';') +
      '|' + (s.vehicles ?? []).filter((v) => v.side === this.viewSide).map((v) => `${v.x},${v.y}`).join(';');
    if (!force && key === this.fogKey) return;
    this.fogKey = key;
    const m = s.map;
    const topZ = (x: number, y: number) => {
      for (let k = Math.min(this.viewLevel, m.levels - 1); k > 0; k--) if (m.cells[k][y][x].floor) return k;
      return 0;
    };
    const seen = visibleCells(s, this.viewSide, topZ);
    const g = new GeoBuilder();
    const lit = new GeoBuilder();
    for (let y = 0; y < m.height; y++)
      for (let x = 0; x < m.width; x++) {
        let z = 0;
        for (let k = Math.min(this.viewLevel, m.levels - 1); k > 0; k--)
          if (m.cells[k][y][x].floor) {
            z = k;
            break;
          }
        const c = { x, y, z };
        const p = cellWorld(c, groundHeight(m, c));
        const k = seen.get(`${x},${y},${z}`);
        // Уночі: що бачить ПНБ — зеленувато підсвічене, промінь ліхтаря — тепле світло.
        if (k === 'nvg') lit.box(p.x, p.y + 0.06, p.z, 1, 0.02, 1, [0.45, 0.95, 0.5], 0.2);
        else if (k === 'light') lit.box(p.x, p.y + 0.06, p.z, 1, 0.02, 1, [1, 0.88, 0.6], 0.24);
        if (k || s.revealAll) continue;
        g.box(p.x, p.y + 0.07, p.z, 1, 0.02, 1, [0.01, 0.015, 0.03], 0.68);
      }
    this.overlays.get('fog')?.dispose();
    this.overlays.delete('fog');
    this.overlays.get('nightvis')?.dispose();
    this.overlays.delete('nightvis');
    if (!lit.empty) {
      const lm = lit.build('ov_nightvis', this.scene, this.overlayMat);
      lm.isPickable = false;
      lm.hasVertexAlpha = true;
      this.overlays.set('nightvis', lm);
    }
    if (g.empty) return;
    const mesh = g.build('ov_fog', this.scene, this.overlayMat);
    mesh.isPickable = false;
    mesh.hasVertexAlpha = true;
    this.overlays.set('fog', mesh);
  }

  refreshVisibility(): void {
    const s = this.state;
    const inside = new Set<number>();
    for (const u of s.units) {
      if (u.side !== this.viewSide || !u.pos || u.status === 'evacuated') continue;
      const b = cellAt(s.map, u.pos)?.buildingId;
      if (b !== undefined && cellAt(s.map, u.pos)!.terrain === 'floor') inside.add(b);
    }
    this.map.applyVisibility(this.viewLevel, inside);
    this.shadowsDirty = true;
    this.refreshSmoke();
    this.refreshFire();
    for (const u of s.units) {
      const m = this.units.get(u.id);
      if (m && u.pos && u.pos.z > this.viewLevel) m.root.setEnabled(false);
    }
  }

  select(u: Unit | null): void {
    if (!u?.pos) {
      this.selRing.setEnabled(false);
      return;
    }
    this.selRing.setEnabled(true);
    this.selRing.position = cellWorld(u.pos, groundHeight(this.state.map, u.pos)).add(new Vector3(0, 0.04, 0));
  }

  // ---------- Підсвітки ----------

  setOverlay(name: string, cells: OverlayCell[], opts: { height?: number; size?: number; alpha?: number } = {}): void {
    this.overlays.get(name)?.dispose();
    this.overlays.delete(name);
    if (!cells.length) return;
    const g = new GeoBuilder();
    const s = this.state;
    for (const { cell, color } of cells) {
      const p = cellWorld(cell, groundHeight(s.map, cell));
      g.box(p.x, p.y + (opts.height ?? 0.035), p.z, opts.size ?? 0.86, 0.02, opts.size ?? 0.86, color, opts.alpha ?? 0.45);
    }
    const mesh = g.build(`ov_${name}`, this.scene, this.overlayMat);
    mesh.isPickable = false;
    mesh.hasVertexAlpha = true;
    this.overlays.set(name, mesh);
  }

  setPath(path: Cell[], color: RGB): void {
    this.overlays.get('path')?.dispose();
    this.overlays.delete('path');
    if (path.length < 2) return;
    const g = new GeoBuilder();
    const s = this.state;
    for (let i = 1; i < path.length; i++) {
      const a = cellWorld(path[i - 1], groundHeight(s.map, path[i - 1]));
      const b = cellWorld(path[i], groundHeight(s.map, path[i]));
      const mid = Vector3.Lerp(a, b, 0.5);
      const len = Vector3.Distance(a, b);
      const ang = Math.atan2(b.x - a.x, b.z - a.z);
      g.box(mid.x, mid.y + 0.08, mid.z, 0.08, 0.04, len, color, 0.9, ang);
    }
    const end = path[path.length - 1];
    const e = cellWorld(end, groundHeight(s.map, end));
    g.box(e.x, e.y + 0.08, e.z, 0.3, 0.05, 0.3, color, 0.95);
    const mesh = g.build('ov_path', this.scene, this.overlayMat);
    mesh.isPickable = false;
    mesh.hasVertexAlpha = true;
    this.overlays.set('path', mesh);
  }

  setCursor(cell: Cell | null, color: RGB = [1, 1, 1]): void {
    this.overlays.get('cursor')?.dispose();
    this.overlays.delete('cursor');
    if (!cell) return;
    const p = cellWorld(cell, groundHeight(this.state.map, cell));
    const g = new GeoBuilder();
    const y = p.y + 0.06;
    g.box(p.x, y, p.z - 0.47, 1, 0.04, 0.06, color);
    g.box(p.x, y, p.z + 0.47, 1, 0.04, 0.06, color);
    g.box(p.x - 0.47, y, p.z, 0.06, 0.04, 1, color);
    g.box(p.x + 0.47, y, p.z, 0.06, 0.04, 1, color);
    const mesh = g.build('ov_cursor', this.scene, this.overlayMat);
    mesh.isPickable = false;
    mesh.hasVertexAlpha = true;
    this.overlays.set('cursor', mesh);
  }

  /** Підсвічування межі клітинки (редактор тонких об'єктів). */
  setEdgeHint(cell: Cell | null, side: 'n' | 's' | 'w' | 'e'): void {
    this.overlays.get('edgehint')?.dispose();
    this.overlays.delete('edgehint');
    if (!cell) return;
    const p = cellWorld(cell, groundHeight(this.state.map, cell));
    const g = new GeoBuilder();
    const y = p.y + 0.3;
    if (side === 'n') g.box(p.x, y, p.z + 0.5, 1, 0.6, 0.08, [1, 0.6, 0.15], 0.8);
    else if (side === 's') g.box(p.x, y, p.z - 0.5, 1, 0.6, 0.08, [1, 0.6, 0.15], 0.8);
    else if (side === 'w') g.box(p.x - 0.5, y, p.z, 0.08, 0.6, 1, [1, 0.6, 0.15], 0.8);
    else g.box(p.x + 0.5, y, p.z, 0.08, 0.6, 1, [1, 0.6, 0.15], 0.8);
    const mesh = g.build('ov_edgehint', this.scene, this.overlayMat);
    mesh.isPickable = false;
    mesh.hasVertexAlpha = true;
    this.overlays.set('edgehint', mesh);
  }

  /** Маркери останніх відомих позицій противника. */
  setGhosts(cells: Cell[]): void {
    this.overlays.get('ghosts')?.dispose();
    this.overlays.delete('ghosts');
    const vis = cells.filter((c) => c.z <= this.viewLevel);
    if (!vis.length) return;
    const g = new GeoBuilder();
    for (const c of vis) {
      const p = cellWorld(c, groundHeight(this.state.map, c));
      g.box(p.x, p.y + 0.45, p.z, 0.3, 0.9, 0.3, hex(SIDE_COLOR.red), 0.35);
      g.box(p.x, p.y + 1.05, p.z, 0.22, 0.22, 0.22, hex(SIDE_COLOR.red), 0.5);
    }
    const mesh = g.build('ov_ghosts', this.scene, this.overlayMat);
    mesh.isPickable = false;
    mesh.hasVertexAlpha = true;
    this.overlays.set('ghosts', mesh);
  }

  // ---------- Вибір ----------

  pickUnit(x: number, y: number): string | null {
    const r = this.scene.pick(x, y, (m) => !!m.metadata?.hitbox && !m.metadata.vehicle && !m.metadata.drone && m.isEnabled());
    return r?.hit ? (r.pickedMesh!.metadata.unitId as string) : null;
  }

  pickVehicle(x: number, y: number): string | null {
    const r = this.scene.pick(x, y, (m) => !!m.metadata?.vehicle && m.isEnabled());
    return r?.hit ? (r.pickedMesh!.metadata.vehicleId as string) : null;
  }

  pickDrone(x: number, y: number): string | null {
    const r = this.scene.pick(x, y, (m) => !!m.metadata?.drone && m.isEnabled());
    return r?.hit ? (r.pickedMesh!.metadata.droneId as string) : null;
  }

  // ---------- Дрони ----------

  private droneModels = new Map<string, DroneModel>();

  isDroneShown(id: string): boolean {
    return !!this.droneModels.get(id)?.root.isEnabled();
  }
  private droneShadows = new Map<string, Mesh>();

  /** Візуальна висота дрона: над найвищою підлогою під ним (щоб лишався в кадрі). */
  private dronePos(d: DroneState, x = d.x, y = d.y) {
    const m = this.state.map;
    let top = 0;
    for (let z = m.levels - 1; z >= 0; z--)
      if (m.cells[z][y]?.[x]?.floor) {
        top = z + (z === 0 ? m.cells[0][y][x].elevation : 0);
        break;
      }
    void droneAltitude;
    if (d.alt !== undefined && d.alt < m.levels) top = d.alt + (d.alt === 0 ? m.cells[0][y]?.[x]?.elevation ?? 0 : 0) - 0.35;
    return world(x + 0.5, y + 0.5, top + 1.25);
  }

  syncDrones(): void {
    const s = this.state;
    const live = new Set((s.drones ?? []).filter((d) => !d.destroyed).map((d) => d.id));
    for (const [id, m] of this.droneModels)
      if (!live.has(id)) {
        m.root.dispose();
        this.droneModels.delete(id);
        this.droneShadows.get(id)?.dispose();
        this.droneShadows.delete(id);
      }
    for (const d of s.drones ?? []) {
      if (d.destroyed) continue;
      let m = this.droneModels.get(d.id);
      if (!m) {
        m = buildDroneModel(this.scene, this.unitMat2(), d, hex(SIDE_COLOR[d.side]));
        this.droneModels.set(d.id, m);
        const sh = new GeoBuilder().box(0, 0, 0, 0.5, 0.01, 0.5, [0, 0, 0], 0.35).build('dshadow', this.scene, this.overlayMat);
        sh.hasVertexAlpha = true;
        sh.isPickable = false;
        this.droneShadows.set(d.id, sh);
      }
      m.root.position = this.dronePos(d);
      const seen = droneNoticedBy(s, this.viewSide, d);
      m.root.setEnabled(seen);
      const sh = this.droneShadows.get(d.id)!;
      sh.position = world(d.x + 0.5, d.y + 0.5, groundHeight(s.map, { x: d.x, y: d.y, z: 0 }) + 0.02);
      sh.setEnabled(seen);
    }
  }

  private plainMat: StandardMaterial | null = null;
  private unitMat2(): StandardMaterial {
    return (this.plainMat ??= makeMaterial(this.scene, 'droneMat'));
  }

  private spinRotors(): void {
    for (const m of this.droneModels.values()) for (const r of m.rotors) r.rotation.y += 0.9;
  }

  private async animateDrone(e: Extract<SimEvent, { t: 'drone' }>): Promise<void> {
    const m = this.droneModels.get(e.droneId);
    const d = this.state.drones?.find((x) => x.id === e.droneId);
    if (!m || !d) {
      this.syncDrones();
      return;
    }
    if (e.path && e.path.length > 1 && m.root.isEnabled()) {
      for (let i = 1; i < e.path.length; i++) {
        const a = this.dronePos(d, e.path[i - 1].x, e.path[i - 1].y);
        const b = this.dronePos(d, e.path[i].x, e.path[i].y);
        m.root.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
        await this.anim.tween(70, (t) => (m.root.position = Vector3.Lerp(a, b, t)));
      }
    }
    if (e.attack) {
      const a = m.root.position.clone();
      const b = cellWorld(e.attack, groundHeight(this.state.map, e.attack) + 0.3);
      m.root.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
      m.root.rotation.x = 0.8;
      await this.anim.tween(420, (t) => (m.root.position = Vector3.Lerp(a, b, t * t)));
    } else if (e.lost && m.root.isEnabled()) {
      const a = m.root.position.clone();
      const ground = world(a.x, -a.z, 0);
      await this.anim.tween(450, (t) => {
        m.root.position = Vector3.Lerp(a, ground, t * t);
        m.root.rotation.z = t * 3;
      });
    }
    this.syncDrones();
  }

  // ---------- Техніка ----------

  private vehicleModels = new Map<string, VehicleModel>();
  private wreckMat: StandardMaterial | null = null;

  private ensureVehicle(v: VehicleState): VehicleModel {
    let m = this.vehicleModels.get(v.id);
    if (!m) {
      m = buildVehicleModel(this.scene, this.sideMat(v.side), v, this.sideTile(v.side));
      for (const mesh of m.meshes) {
        mesh.receiveShadows = true;
        this.shadowGen?.addShadowCaster(mesh);
      }
      this.vehicleModels.set(v.id, m);
    }
    return m;
  }

  private placeVehicle(v: VehicleState, m: VehicleModel, x = v.x, y = v.y): void {
    const [w, h] = vehicleDef(v.defId).footprint;
    m.root.position = world(x + w / 2, y + h / 2, groundHeight(this.state.map, { x, y, z: 0 }));
    m.root.rotation.y = facingAngle(v.facing);
  }

  syncVehicles(): void {
    const s = this.state;
    for (const v of s.vehicles ?? []) {
      const m = this.ensureVehicle(v);
      this.placeVehicle(v, m);
      m.root.setEnabled(this.viewLevel >= 0 && (v.destroyed || vehicleSeenBy(s, this.viewSide, v)));
      if (v.destroyed) {
        this.wreckMat ??= (() => {
          const w = makeMaterial(this.scene, 'wreck');
          w.diffuseColor = new Color3(0.12, 0.11, 0.1);
          return w;
        })();
        for (const mesh of m.meshes) mesh.material = this.wreckMat;
      }
    }
  }

  vehicleScreenPos(id: string): { x: number; y: number } | null {
    const v = this.state.vehicles?.find((x) => x.id === id);
    if (!v) return null;
    return this.project({ x: v.x + 1, y: v.y + 1, z: 0 }, 1.2);
  }

  private async animateVehicle(id: string, path: Cell[]): Promise<void> {
    const v = this.state.vehicles?.find((x) => x.id === id);
    const m = v && this.vehicleModels.get(id);
    if (!v || !m || path.length < 2) return;
    const [w, h] = vehicleDef(v.defId).footprint;
    const pos = (c: Cell) => world(c.x + w / 2, c.y + h / 2, groundHeight(this.state.map, c));
    for (let i = 1; i < path.length; i++) {
      const a = pos(path[i - 1]);
      const b = pos(path[i]);
      const dx = path[i].x - path[i - 1].x;
      const dy = path[i].y - path[i - 1].y;
      m.root.rotation.y = facingAngle(dx > 0 ? 1 : dx < 0 ? 3 : dy > 0 ? 2 : 0);
      await this.anim.tween(140, (t) => (m.root.position = Vector3.Lerp(a, b, t)));
    }
  }

  private async animateVehicleHit(id: string, penetrated: boolean): Promise<void> {
    const v = this.state.vehicles?.find((x) => x.id === id);
    if (!v) return;
    const p = world(v.x + 1, v.y + 1, 0.6);
    const spark = CreateSphere('spark', { diameter: penetrated ? 0.7 : 0.3, segments: 4 }, this.scene);
    spark.material = this.fxMat;
    spark.position = p;
    await this.anim.tween(140, (t) => spark.scaling.setAll(1 + t));
    spark.dispose();
  }


  pickCell(x: number, y: number): Cell | null {
    const ray = this.scene.createPickingRay(x, y, Matrix.Identity(), this.camera);
    const s = this.state;
    for (let z = this.viewLevel; z >= 0; z--) {
      let planeY = z * LH();
      for (let iter = 0; iter < 2; iter++) {
        if (Math.abs(ray.direction.y) < 1e-6) return null;
        const t = (planeY - ray.origin.y) / ray.direction.y;
        const p = ray.origin.add(ray.direction.scale(t));
        const c = { x: Math.floor(p.x), y: Math.floor(-p.z), z };
        const cell = cellAt(s.map, c);
        if (!cell) break;
        if (z === 0 && cell.elevation > 0 && iter === 0) {
          planeY = cell.elevation * LH();
          continue;
        }
        if (cell.floor) return c;
        break;
      }
    }
    return null;
  }

  /** Проекція точки світу на екран (CSS-пікселі) — для спливаючих написів. */
  project(c: Cell, h: number): { x: number; y: number } | null {
    const v = Vector3.Project(
      cellWorld(c, h),
      Matrix.Identity(),
      this.scene.getTransformMatrix(),
      this.camera.viewport.toGlobal(this.engine.getRenderWidth(), this.engine.getRenderHeight()),
    );
    const k = this.engine.getHardwareScalingLevel();
    return { x: v.x * k, y: v.y * k };
  }

  unitScreenPos(unitId: string): { x: number; y: number } | null {
    const u = this.state.units.find((x) => x.id === unitId);
    if (!u?.pos) return null;
    return this.project(u.pos, groundHeight(this.state.map, u.pos) + 1.0);
  }

  // ---------- Відтворення подій ----------

  async play(events: SimEvent[], onFloat: (e: Extract<SimEvent, { t: 'float' }>) => void): Promise<void> {
    for (const e of events) {
      switch (e.t) {
        case 'moved':
          if (this.isShown(e.unitId) || this.viewSide === this.unitSide(e.unitId)) await this.animateMove(e.unitId, e.path, e.mode);
          break;
        case 'fired':
          await this.animateFire(e);
          break;
        case 'grenade':
          sfx('throw', this.sdist(pointWorld(e.from)));
          await this.animateGrenade(e.from, e.to);
          break;
        case 'rocket':
          sfx('rocket', this.sdist(pointWorld(e.from)));
          await this.animateRocket(e.from, e.to);
          break;
        case 'smoke':
          this.refreshSmoke();
          break;
        case 'fire':
          this.refreshFire();
          this.refreshFog(true);
          break;
        case 'vehicle':
          if (e.path) {
            const vv = this.state.vehicles?.find((x) => x.id === e.vehicleId);
            engineSfx(this.vehDist(e.vehicleId), (e.path.length - 1) * 0.14 / this.anim.speed, vv ? vehicleDef(vv.defId).kind === 'tracked' : true);
          }
          if (e.path && this.vehicleModels.get(e.vehicleId)?.root.isEnabled()) await this.animateVehicle(e.vehicleId, e.path);
          this.syncVehicles();
          break;
        case 'drone':
          sfx(e.lost ? 'thud' : 'drone', this.droneModels.get(e.droneId) ? this.sdist(this.droneModels.get(e.droneId)!.root.position) : 12);
          await this.animateDrone(e);
          break;
        case 'vehicleHit':
          sfx('clang', this.vehDist(e.vehicleId));
          if (this.state.vehicles?.find((x) => x.id === e.vehicleId)?.destroyed && !this.wrecked.has(e.vehicleId)) {
            this.wrecked.add(e.vehicleId);
            vehicleDestroyedSfx(this.vehDist(e.vehicleId));
          }
          await this.animateVehicleHit(e.vehicleId, e.penetrated);
          break;
        case 'explosion':
          sfx('boom', this.sdist(pointWorld(e.at)));
          this.addScar(pointWorld(e.at), e.radius);
          await this.animateExplosion(e.at, e.radius);
          break;
        case 'object':
          this.map.rebuildObject(e.cell);
          this.refreshVisibility();
          break;
        case 'status':
          if ((e.status === 'dead' || e.status === 'down') && this.isShown(e.unitId)) await this.animateFall(e.unitId);
          this.syncUnit(e.unitId);
          await this.anim.wait(150);
          break;
        case 'damaged':
          if (this.isShown(e.unitId)) await this.animateFlinch(e.unitId);
          break;
        case 'pose':
        case 'deployed':
        case 'reinforcement':
        case 'evacuated':
        case 'carry':
          this.syncUnit(e.unitId);
          break;
        case 'float':
          onFloat(e);
          break;
        case 'sound':
          sfx(e.kind);
          break;
        case 'reload':
          sfx('click', this.unitDist(e.unitId));
          await this.animateReload(e.unitId);
          break;
        case 'reaction':
        case 'panic':
          await this.anim.wait(120);
          break;
        default:
          break;
      }
    }
    this.sync();
  }

  private unitSide(id: string): SideId | undefined {
    return this.state.units.find((u) => u.id === id)?.side;
  }

  private isShown(id: string): boolean {
    return this.units.get(id)?.root.isEnabled() ?? false;
  }

  /** Падіння бійця (поранений/загиблий). */
  private async animateFall(id: string): Promise<void> {
    const m = this.units.get(id);
    if (!m) return;
    const r0 = m.body.rotation.x;
    const y0 = m.body.position.y;
    setTimeout(() => sfx('thud', this.sdist(m.root.position)), 330);
    await this.anim.tween(380, (t) => {
      const k = t * t;
      m.body.rotation.x = r0 + (-Math.PI / 2 - r0) * k;
      m.body.position.y = y0 + Math.sin(t * Math.PI) * 0.08;
    });
  }

  /** Здригання від влучання. */
  private async animateFlinch(id: string): Promise<void> {
    const m = this.units.get(id);
    if (!m) return;
    const r0 = m.torso.rotation.x;
    await this.anim.tween(160, (t) => (m.torso.rotation.x = r0 - Math.sin(t * Math.PI) * 0.35));
    m.torso.rotation.x = r0;
  }

  private syncUnit(id: string): void {
    const u = this.state.units.find((x) => x.id === id);
    // Зміна вигляду спорядження (ПНБ відкинуто/опущено) — перебудувати модель.
    const old = this.units.get(id);
    if (u && old && (old.root.metadata?.nvgUp ?? false) !== !!u.nvgUp) {
      old.root.dispose();
      this.units.delete(id);
      this.beams.delete(id);
    }
    const m = this.units.get(id) ?? (u ? this.ensureUnit(u) : undefined);
    if (m && u) m.root.metadata = { nvgUp: !!u.nvgUp };
    if (!u || !m) return;
    if (!u.pos) {
      m.root.setEnabled(false);
      return;
    }
    m.root.position = cellWorld(u.pos, groundHeight(this.state.map, u.pos));
    applyPose(m, u.stance, u.weaponState, u.status);
    this.updateBeam(u, m);
  }

  private face(m: UnitModel, from: Vector3, to: Vector3): void {
    if (Math.abs(to.x - from.x) + Math.abs(to.z - from.z) > 1e-3) m.root.rotation.y = Math.atan2(to.x - from.x, to.z - from.z);
  }

  private async animateMove(id: string, path: Cell[], mode: string): Promise<void> {
    const m = this.units.get(id);
    const u = this.state.units.find((x) => x.id === id);
    if (!m || !u) return;
    const per = mode === 'fast' ? 110 : mode === 'careful' ? 230 : 160;
    const enemyVisibleNow = u.side !== this.viewSide;
    for (let i = 1; i < path.length; i++) {
      const a = cellWorld(path[i - 1], groundHeight(this.state.map, path[i - 1]));
      const b = cellWorld(path[i], groundHeight(this.state.map, path[i]));
      this.face(m, a, b);
      if (enemyVisibleNow) m.root.setEnabled(path[i].z <= this.viewLevel && this.visibleCellForViewer(path[i]));
      const legL = m.legL.parent!;
      const legR = m.legR.parent!;
      if (m.root.isEnabled()) sfx('step', this.sdist(b) + (mode === 'careful' ? 12 : 0));
      await this.anim.tween(per, (t) => {
        m.root.position = Vector3.Lerp(a, b, t);
        // Хода: ноги, легке підстрибування тіла й похитування корпусу.
        const sw = Math.sin(t * Math.PI * 2);
        if (u.stance === 'standing') {
          (legL as any).rotation.x = sw * 0.55;
          (legR as any).rotation.x = -sw * 0.55;
          m.body.position.y = Math.abs(sw) * 0.035;
          m.torso.rotation.y = sw * 0.06;
        } else if (u.stance === 'crouched') {
          (legL as any).rotation.x = -1.35 + sw * 0.25;
          (legR as any).rotation.x = 0.35 - sw * 0.25;
          m.body.position.y = Math.abs(sw) * 0.015;
        } else m.body.position.z = -0.3 + sw * 0.04;
      });
    }
    applyPose(m, u.stance, u.weaponState, u.status);
    if (u.side === this.viewSide) this.select(u);
  }

  /** Чи видно клітинку глядачу (для показу руху противника). */
  private visibleCellForViewer(c: Cell): boolean {
    const contact = Object.values(this.state.contacts[this.viewSide]).find((k) => k.pos.x === c.x && k.pos.y === c.y && k.pos.z === c.z && k.visible);
    return !!contact || this.state.revealAll;
  }

  private scars: { p: Vector3; r: number }[] = [];
  /** Техніка, для якої вже прозвучав звук знищення. */
  private wrecked = new Set<string>();
  private lastCam = '';

  /** Камера зрушилась (тіні від спрямованого світла залежать від кадру). */
  private camMoved(): boolean {
    const c = this.camera;
    const k = `${c.alpha.toFixed(3)},${c.beta.toFixed(3)},${c.target.x.toFixed(2)},${c.target.z.toFixed(2)},${(c.orthoTop ?? 0).toFixed(2)}`;
    if (k === this.lastCam) return false;
    this.lastCam = k;
    return true;
  }

  /** Вирва й кіптява від вибуху (лишаються на землі до кінця бою). */
  private addScar(p: Vector3, radius: number): void {
    this.scars.push({ p, r: Math.min(1.4, 0.45 + radius * 0.25) });
    const g = new GeoBuilder();
    this.scars.forEach(({ p: q, r }, k) => {
      const y = q.y - 0.12;
      g.box(q.x, y + 0.012 + k * 0.0003, q.z, r * 2, 0.006, r * 2, [0.13, 0.11, 0.09], 0.75);
      g.box(q.x, y + 0.015 + k * 0.0003, q.z, r, 0.008, r, [0.07, 0.06, 0.05], 0.9);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + k;
        g.box(q.x + Math.cos(a) * r * 0.9, y + 0.03, q.z + Math.sin(a) * r * 0.9, 0.09, 0.05, 0.07, [0.32, 0.27, 0.2]);
      }
    });
    this.overlays.get('scars')?.dispose();
    const mesh = g.build('ov_scars', this.scene, this.overlayMat);
    mesh.isPickable = false;
    mesh.hasVertexAlpha = true;
    this.overlays.set('scars', mesh);
  }

  /** Відстань від центру огляду камери (для гучності звуку). */
  private sdist(p: Vector3): number {
    return Vector3.Distance(p, this.camera.target) * 0.6;
  }

  private unitDist(id: string): number {
    const m = this.units.get(id);
    return m ? this.sdist(m.root.position) : 15;
  }

  private vehDist(id: string): number {
    const m = this.vehicleModels.get(id);
    return m ? this.sdist(m.root.position) : 15;
  }

  private async animateFire(e: Extract<SimEvent, { t: 'fired' }>): Promise<void> {
    const m = this.units.get(e.unitId);
    const from = pointWorld(e.from);
    const shooter = this.state.units.find((x) => x.id === e.unitId);
    const w = shooter?.inventory.primary ? itemDef<WeaponDefinition>(shooter.inventory.primary.defId) : null;
    const snd: Sfx = !w ? 'rifle' : w.category === 'lmg' ? 'lmg' : w.category === 'marksman' ? 'dmr' : 'rifle';
    const dist = this.sdist(from);
    if (m && e.shots.length) this.face(m, m.root.position, pointWorld(e.shots[0].to));
    const shooterShown = this.isShown(e.unitId);
    for (const sh of e.shots) {
      const to = pointWorld(sh.to);
      const flash = CreateSphere('flash', { diameter: 0.22, segments: 4 }, this.scene);
      flash.material = this.fxMat;
      flash.position = from;
      flash.isPickable = false;
      flash.setEnabled(shooterShown);
      if (shooter?.inVehicle) vehicleGunSfx(dist, 1);
      else sfx(snd, dist);
      // Віддача: корпус відкидає назад.
      if (m && shooterShown) {
        const r0 = m.torso.rotation.x;
        void this.anim.tween(90, (t) => (m.torso.rotation.x = r0 + Math.sin(t * Math.PI) * 0.12)).then(() => (m.torso.rotation.x = r0));
      }
      const len = Vector3.Distance(from, to);
      const g = new GeoBuilder().box(0, 0, len / 2, 0.035, 0.035, len, [1, 0.9, 0.4]);
      const tracer = g.build('tracer', this.scene, this.fxMat);
      tracer.isPickable = false;
      tracer.position = from;
      tracer.lookAt(to);
      const impact = new GeoBuilder();
      for (let i = 0; i < 4; i++) impact.box((Math.random() - 0.5) * 0.2, Math.random() * 0.15, (Math.random() - 0.5) * 0.2, 0.06, 0.06, 0.06, sh.hitUnit ? [0.8, 0.1, 0.1] : [0.75, 0.7, 0.6]);
      const puff = impact.build('impact', this.scene, this.fxMat);
      puff.position = to;
      puff.isPickable = false;
      await this.anim.tween(70, (t) => {
        tracer.scaling.z = t;
      });
      flash.dispose();
      await this.anim.tween(70, (t) => {
        tracer.scaling.z = 1 - t;
        tracer.position = Vector3.Lerp(from, to, t);
        puff.scaling.setAll(1 + t);
      });
      tracer.dispose();
      puff.dispose();
    }
    await this.anim.wait(80);
  }

  private async animateGrenade(from: Point, to: Point): Promise<void> {
    const a = pointWorld(from);
    const b = pointWorld(to);
    const g = CreateSphere('nade', { diameter: 0.14, segments: 4 }, this.scene);
    const mat = makeMaterial(this.scene, 'nadeMat');
    mat.diffuseColor = new Color3(0.2, 0.25, 0.15);
    g.material = mat;
    const hgt = Math.max(1.5, Vector3.Distance(a, b) * 0.35);
    await this.anim.tween(450, (t) => {
      const p = Vector3.Lerp(a, b, t);
      p.y += Math.sin(t * Math.PI) * hgt;
      g.position = p;
    });
    g.dispose();
    mat.dispose();
  }

  private async animateRocket(from: Point, to: Point): Promise<void> {
    const a = pointWorld(from);
    const b = pointWorld(to);
    const rocket = new GeoBuilder().box(0, 0, 0, 0.08, 0.08, 0.32, [0.25, 0.3, 0.2]).build('rocket', this.scene, this.fxMat);
    rocket.lookAt(b.subtract(a));
    const smoke: Mesh[] = [];
    const len = Vector3.Distance(a, b);
    await this.anim.tween(Math.max(150, len * 35), (t) => {
      const p = Vector3.Lerp(a, b, t);
      rocket.position = p;
      rocket.lookAt(b);
      if (smoke.length < 24 && Math.random() < 0.6) {
        const puff = new GeoBuilder().box(0, 0, 0, 0.12, 0.12, 0.12, [0.75, 0.75, 0.72], 0.6).build('smoke', this.scene, this.overlayMat);
        puff.hasVertexAlpha = true;
        puff.position = p.clone();
        smoke.push(puff);
      }
    });
    rocket.dispose();
    void this.anim.tween(500, (t) => smoke.forEach((m) => m.scaling.setAll(1 + t * 2))).then(() => smoke.forEach((m) => m.dispose()));
  }

  private async animateExplosion(at: Point, radius: number): Promise<void> {
    const p = pointWorld(at);
    const ball = CreateSphere('boom', { diameter: 1, segments: 8 }, this.scene);
    const mat = makeMaterial(this.scene, 'boomMat', 0.9, true);
    mat.emissiveColor = new Color3(1, 0.55, 0.15);
    ball.material = mat;
    ball.position = p;
    const debris = new GeoBuilder();
    const dirs: Vector3[] = [];
    for (let i = 0; i < 14; i++) {
      debris.box(0, 0, 0, 0.08, 0.08, 0.08, [0.3, 0.27, 0.22]);
      dirs.push(new Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.2, Math.random() - 0.5).normalize());
    }
    const parts: Mesh[] = dirs.map((_, i) => {
      const m = new GeoBuilder().box(0, 0, 0, 0.09, 0.09, 0.09, [0.28 + i * 0.01, 0.25, 0.2]).build('deb', this.scene, this.fxMat);
      m.position = p.clone();
      return m;
    });
    await this.anim.tween(380, (t) => {
      ball.scaling.setAll(radius * 1.6 * ease(t));
      mat.alpha = 0.9 * (1 - t);
      parts.forEach((m, i) => {
        m.position = p.add(dirs[i].scale(t * radius * 1.2));
        m.position.y += -t * t * 0.8;
      });
    });
    ball.dispose();
    mat.dispose();
    parts.forEach((m) => m.dispose());
  }

  private async animateReload(id: string): Promise<void> {
    const m = this.units.get(id);
    if (!m) return;
    const y0 = m.weapon.position.y;
    await this.anim.tween(300, (t) => (m.weapon.position.y = y0 - Math.sin(t * Math.PI) * 0.12));
  }

  /** Знімок поточних ключів клітинок під бійцями (для UI). */
  unitAtCellKey(): Map<string, string> {
    const map = new Map<string, string>();
    for (const u of this.state.units) if (u.pos && u.status === 'active') map.set(cellKey(u.pos), u.id);
    return map;
  }
}
