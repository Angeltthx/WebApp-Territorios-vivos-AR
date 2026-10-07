import {
  ACESFilmicToneMapping,
  Box3,
  CircleGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Quaternion,
  SkinnedMesh,
  Vector3 as ThreeVector3,
} from 'three';
import type { ArModel } from '@domain/entities/ArModel';
import type { Placement } from '@domain/entities/Placement';
import type { Discovery } from '@domain/value-objects/Discovery';
import { ModelId } from '@domain/value-objects/ModelId';
import { Stabilization } from '@domain/value-objects/Stabilization';
import type { HintSpec, ScenePort } from '@application/ports/ScenePort';
import type { MindArRuntime } from '../mindar/MindArRuntime';
import { copyIcon, IconLoader } from './IconLoader';
import { MarkerPin, STAGE_LOOK_DOWN } from './MarkerPin';
import { PoseFilter } from './PoseFilter';
import { addEnvironment, addThreePointLighting } from './ThreePointLighting';
import { MapTextHotspot } from './MapTextHotspot';
import { TapHint } from './TapHint';
import type { MapText } from '@domain/value-objects/MapText';

/**
 * Adaptador de render.
 *
 * Jerarquía deliberada:
 *   scene → follower (pose del marcador, SUAVIZADA)
 *             → overlay (ajuste global)
 *               → MarkerPin ×4 (uno por animal, CLAVADO a su punto del mapa)
 *
 * El contenido NO cuelga directamente del anchor de MindAR. Colgarlo hace
 * que herede el temblor cuadro a cuadro del motor de visión. En su lugar
 * copiamos la pose del anchor cada frame con interpolación exponencial.
 * Es la mejora más perceptible en estabilidad, y el nivel se ajusta en
 * caliente desde la UI.
 *
 * La geometría de cada pin y la conversión de coordenadas viven en
 * MarkerPin, que no depende de MindAR y por eso se puede verificar sin
 * cámara.
 */
/**
 * A qué distancia de la cámara se planta el animal en primer plano, medido
 * en anchos de mapa. Tiene que quedar MÁS CERCA que el marcador para que se
 * dibuje por delante de él: el mapa suele estar a más de un ancho.
 */
const STAGE_DISTANCE = 0.5;
/**
 * Cuánto del alto de la pantalla puede ocupar el animal en primer plano.
 */
const STAGE_FILL = 0.4;
/** Cuánto del ancho puede ocupar, medido por la silueta que ve la cámara. */
const STAGE_FILL_WIDTH = 0.95;
/**
 * Cuánto se sube el animal sobre el centro de la pantalla, en fracción del
 * alto visible: la ficha ocupa la parte de abajo, y centrado quedaba medio
 * tapado. Así queda en el hueco libre de arriba.
 */
const STAGE_LIFT = 0.13;
/**
 * Fracción del ancho de pantalla que puede llegar a ocupar el animal en
 * primer plano CONTANDO la perspectiva. La ballena de frente apunta su largo
 * a la cámara: el ajuste por la silueta proyectada la dejaba medir hasta
 * 1,3 veces el ancho, y en perspectiva el morro, más cerca, se veía aún
 * mayor —más grande que la pantalla—. Los animales pequeños nunca llegan.
 */
const STAGE_MAX_WIDTH = 0.82;
/**
 * Con varios ejemplares en primer plano (las dos ranas), el hueco entre uno
 * y otro, en lados del principal. Van en fila, con los pies a la misma
 * altura, cada uno a su escala del catálogo.
 */
const STAGE_COMPANION_GAP = 0.08;
/**
 * Mientras su animal quede dentro de este margen de la pantalla (en
 * coordenadas normalizadas, ±1 es el borde), la mano de "toca un animal" no
 * cambia de animal.
 */
const HINT_KEEP_NDC = 0.85;
/**
 * Cuándo la mano se pasa a OTRO candidato: si ese queda casi en el centro
 * (a menos de esto del centro, en coordenadas normalizadas) y el suyo ya no
 * (más allá de `HINT_LET_GO_NDC`). Es "acercarse a otro animal": la
 * cámara lo pone en medio. Moverse un poco no basta para que salte.
 */
const HINT_GRAB_NDC = 0.28;
const HINT_LET_GO_NDC = 0.45;
/**
 * …y además la cámara está CERCA de él, en anchos de mapa. Centrado solo no
 * basta: con el mapa entero en pantalla, el centro cae cerca del cangrejo,
 * y la mano abandonaría la ballena nada más empezar. Con el mapa entero a
 * la vista la cámara está a ~1,3–1,5 anchos; acercarse a un animal la deja
 * bastante por debajo de 1. Si en el teléfono salta demasiado pronto o
 * demasiado tarde, este es el número.
 */
const HINT_APPROACH_DISTANCE = 0.85;
/*
 * Estos tres topes SUBIERON (0.32 / 0.6 / 0.62 → 0.4 / 0.95 / 0.82) y aun
 * así el plano es más abierto que antes. Los anteriores se calibraron a ojo
 * contra una medida falsa: el primer plano medía al animal con la caja que
 * three había guardado de una malla animada al construir el pin (ver
 * `setFocus`), y la ballena "medía" casi un cubo de la mitad de su largo.
 * Medida bien, y en tres cuartos, queda en torno a la mitad del ancho de la
 * pantalla —la tortuga y el cangrejo, con su `focusSize`, parecido; la
 * pava, algo menos—, medido en píxeles en /verify-stage.html.
 */

export class ThreeSceneAdapter implements ScenePort {
  private readonly follower = new Group();
  private readonly overlay = new Group();
  private readonly stage = new Group();
  /** Superficie invisible y generosa para que el primer plano sea fácil de tocar. */
  private readonly stageHit = new Mesh(
    new CircleGeometry(1, 24),
    new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, side: DoubleSide }),
  );
  /**
   * Un pin por EJEMPLAR: `frog` es la rana grande y `frog#1` la chica.
   * Casi siempre es uno por animal; para saber de qué animal es cada uno,
   * `pin.modelId`, no la clave.
   */
  private readonly pins = new Map<string, MarkerPin>();
  /** Cuántos animales hay (no pines): lo que cuenta para "los encontró todos". */
  private modelCount = 0;
  /** Los ejemplares prestados al primer plano, cada uno en su hueco de la fila. */
  private staged: { readonly pin: MarkerPin; readonly icon: Object3D; readonly slot: Group | null; readonly hit: Mesh | null }[] = [];
  /** Zona de toque de cada ejemplar en el primer plano, cuando hay varios. */
  private readonly slotHitGeometry = new CircleGeometry(1, 24);
  /** Puntos sobre los textos del mapa; se encienden al aceptar explorarlos. */
  private readonly hotspots = new Map<string, MapTextHotspot>();

  private stabilization: Stabilization = Stabilization.default();
  private elapsed = 0;
  /** Suaviza la pose del mapa: quieto o temblando no mueve a los animales. */
  private readonly poseFilter = new PoseFilter();
  private mounted = false;
  private unsubscribeFrame: (() => void) | null = null;

  /** La mano que enseña a tocar un animal, y sobre cuál está. */
  private readonly tapHint = new TapHint();
  private hint: HintSpec | null = null;
  private hintTarget: string | null = null;
  private splashListener: ((modelId: string, strength: number) => void) | null = null;
  private tapSoundListener: ((modelId: string) => void) | null = null;

  /** El animal en primer plano: su id, su icono prestado y sus medidas naturales. */
  private focusedId: string | null = null;
  private stagedIcon: Object3D | null = null;
  private readonly stagedNaturalSize = new ThreeVector3(1, 1, 1);
  private scale = 1;
  /**
   * Cuánto mide un ancho de mapa en unidades de mundo, del último fotograma
   * con marcador a la vista. Se guarda para que el primer plano siga
   * colocado aunque el mapa se salga de cuadro: alejar la cámara no debe
   * cerrar la ficha.
   */
  private unit = 1;

  private readonly tmpPosition = new ThreeVector3();
  private readonly tmpQuaternion = new Quaternion();
  private readonly tmpScale = new ThreeVector3();
  private readonly tmpWorld = new ThreeVector3();
  private readonly tmpView = new ThreeVector3();
  private readonly tmpNdc = new ThreeVector3();
  private readonly tmpUnit = new ThreeVector3();

  /**
   * @param targetAspect alto/ancho de la imagen compilada en el `.mind`.
   *   Sin esto no se puede convertir un MarkerSpot a coordenadas del
   *   anchor: la unidad vertical depende de la proporción de la imagen.
   */
  constructor(
    private readonly runtime: MindArRuntime,
    private readonly targetAspect: number,
    private readonly mapTexts: readonly MapText[] = [],
  ) {
    this.stageHit.visible = false;
    this.stageHit.position.z = 0.02;
    this.stage.add(this.stageHit);
  }

  async preload(models: readonly ArModel[]): Promise<void> {
    const loader = new IconLoader();
    const [runtime, loaded] = await Promise.allSettled([
      this.runtime.prepare(),
      Promise.all(models.map(async (model) => [model, await loader.load(model)] as const))
        .finally(() => loader.dispose()),
    ]);
    if (loaded.status === 'rejected') throw loaded.reason;
    const icons = loaded.value;

    icons.forEach(([model, icon], index) => {
      // Los compañeros (la rana chica) llevan una copia del icono (ver
      // copyIcon), hecha ANTES de que el pin del original lo marque.
      const copies = model.instances.map((instanceModel, instance) =>
        instance === 0 ? icon : copyIcon(icon, instanceModel.pose.size / model.pose.size));
      model.instances.forEach((instanceModel, instance) => {
        const pin = new MarkerPin(instanceModel, copies[instance]!, index + instance * models.length, this.targetAspect, instance);
        pin.onSplash = (strength) => this.splashListener?.(model.id.value, strength);
        pin.onTapSound = () => this.tapSoundListener?.(model.id.value);
        this.overlay.add(pin.group);
        this.pins.set(instance === 0 ? model.id.value : `${model.id.value}#${instance}`, pin);
      });
    });
    this.modelCount = models.length;
    if (this.mapTexts.length > 0) {
      this.mapTexts.forEach((text, index) => {
        const hotspot = new MapTextHotspot(text, this.targetAspect, index + 1);
        this.overlay.add(hotspot.group);
        this.hotspots.set(text.id, hotspot);
      });
    }
    if (runtime.status === 'rejected') {
      this.clear();
      throw runtime.reason;
    }
    try {
      this.mount();
    } catch (error) {
      this.clear();
      throw error;
    }
  }

  applyPlacement(placement: Placement): void {
    const { offset, scale } = placement;

    // El offset mueve la capa entera; los iconos conservan su sitio
    // relativo sobre el mapa.
    this.overlay.position.set(offset.x, offset.y, offset.z);

    // Cada animal con SU giro: arrastrar uno ya no mueve a los otros tres.
    this.scale = scale.value;
    for (const pin of this.pins.values()) {
      const { yaw, pitch } = placement.orientationOf(ModelId.of(pin.modelId));
      pin.applyTransform(scale.value, yaw, pitch);
    }
  }

  /**
   * Pone la escena de acuerdo con lo descubierto.
   *
   * Fíjate en que revelar es solo hacia adelante: `setRevealed(true)` sobre
   * un animal ya revelado no hace nada, y nunca se llama con `false`. Lo
   * que se descubrió se queda.
   */
  applyDiscovery(discovery: Discovery): void {
    for (const pin of this.pins.values()) {
      if (discovery.isUnlocked(ModelId.of(pin.modelId))) pin.setRevealed(true);
    }
    // Los puntos de los textos: con todos los animales encontrados y nada
    // abierto (con una ficha o un texto en pantalla, apagados).
    const textsOn = discovery.hasFoundAll(this.modelCount) && !discovery.isBusy;
    for (const hotspot of this.hotspots.values()) hotspot.setActive(textsOn);
    this.setFocus(discovery.focused?.value ?? null);
  }

  setStabilization(stabilization: Stabilization): void {
    this.stabilization = stabilization;
  }

  setHint(hint: HintSpec | null): void {
    // Cambia la clase de cosa (animales → textos), el preferido o la lista:
    // se vuelve a elegir.
    if (
      hint === null ||
      this.hint === null ||
      hint.kind !== this.hint.kind ||
      hint.preferred !== this.hint.preferred ||
      (this.hintTarget !== null && !hint.candidates.includes(this.hintTarget))
    ) {
      this.hintTarget = null;
    }
    this.hint = hint;
    this.tapHint.setHint(hint);
  }

  /**
   * Presta el icono de un animal al escenario de primer plano, o lo
   * devuelve a su sitio sobre el mapa.
   *
   * Se MUEVE el objeto en vez de duplicarlo: una copia serían varios megas
   * más de texturas en la GPU, y además tendría que mantenerse igual que el
   * original. Mientras está prestado, su MarkerPin deja de tocarlo.
   */
  private setFocus(id: string | null): void {
    if (this.focusedId === id) return;

    if (this.focusedId !== null) {
      for (const { pin, slot } of this.staged) {
        if (slot !== null) this.stage.remove(slot);
        pin.reclaimWater();
        pin.reclaimIcon();
      }
      this.staged = [];
      this.stagedIcon = null;
    }

    this.focusedId = id;
    this.stageHit.visible = false;
    delete this.stage.userData['modelId'];

    const pins = id === null ? [] : this.pinsOf(id);
    if (id !== null && pins.length > 0) {
      const icons = pins.map((pin) => {
        const icon = pin.releaseIcon();
        icon.scale.setScalar(1);
        icon.rotation.set(0, 0, 0);
        icon.position.set(0, 0, 0);
        return icon;
      });
      // Se mide el principal AHORA, mientras no cuelga de nadie: una vez
      // dentro del escenario su caja de mundo llevaría encima la
      // transformación del escenario y saldría otro número. Los compañeros
      // son el mismo modelo a otra escala del catálogo.
      const icon = icons[0]!;
      icon.updateMatrixWorld(true);
      // TRAMPA: three calcula la caja de una malla animada UNA vez, en la
      // postura de ese momento, y la reutiliza para siempre. Sin
      // recalcularla, la ballena medía 0.10 × 0.14 × 0.10 —casi un cubo,
      // cuando es alargada— y el encaje no sabía lo larga que es: de
      // frente no se notaba, en tres cuartos ocupaba el 90 % del ancho.
      icon.traverse((object) => {
        if (object instanceof SkinnedMesh) object.computeBoundingBox();
      });
      new Box3().setFromObject(icon).getSize(this.stagedNaturalSize);
      this.stagedNaturalSize.set(
        this.stagedNaturalSize.x || 1,
        this.stagedNaturalSize.y || 1,
        this.stagedNaturalSize.z || 1,
      );

      // Todos sus ejemplares, en fila: la rana grande y la chica salen
      // juntas y cada una salta cuando la tocan a ella.
      // Un animal solo va directo al escenario, como siempre.
      pins.forEach((pin, index) => {
        if (pins.length === 1) {
          this.stage.add(icons[index]!);
          this.staged.push({ pin, icon: icons[index]!, slot: null, hit: null });
          return;
        }
        const slot = new Group();
        slot.add(icons[index]!);
        const hit = new Mesh(this.slotHitGeometry, this.stageHit.material);
        hit.userData['modelId'] = id;
        hit.userData['instance'] = pin.instance;
        // Por delante de la zona general del primer plano, que no dice cuál.
        hit.position.z = 0.03;
        slot.add(hit);
        this.stage.add(slot);
        this.staged.push({ pin, icon: icons[index]!, slot, hit });
      });
      const water = pins[0]!.waterGroup;
      if (water !== null) this.stage.add(water);
      this.stagedIcon = icon;
      this.stage.userData['modelId'] = id;
      this.stageHit.visible = true;
    }

    this.stage.visible = this.stagedIcon !== null;
  }

  /**
   * Coloca el primer plano delante de la cámara, fotograma a fotograma.
   *
   * No se cuelga de la cámara como hijo porque MindAR no mete su cámara en
   * la escena, y three solo dibuja lo que cuelga de la escena. Copiar su
   * pose cada fotograma da el mismo resultado y no depende de ese detalle.
   */
  private updateStage(deltaSeconds: number): void {
    const icon = this.stagedIcon;
    if (icon === null) return;

    const camera = this.runtime.mindar.camera;
    const distance = STAGE_DISTANCE * this.unit;

    const fov = (camera.fov * Math.PI) / 180;
    const visibleHeight = 2 * distance * Math.tan(fov / 2);

    this.stage.quaternion.copy(camera.quaternion);
    this.stage.position
      .set(0, visibleHeight * STAGE_LIFT, -distance)
      .applyQuaternion(camera.quaternion)
      .add(camera.position);

    // Sin giro automático: no es un producto en un expositor. Solo gira
    // cuando el usuario lo arrastra con el dedo.
    // Tres cuartos de partida (ver MarkerPin.stageYaw) más lo que el
    // usuario lo haya girado: el mismo giro que lleva sobre el mapa.
    const pin = this.staged[0]?.pin;
    const yaw = (pin?.stageYaw ?? 0) + (pin?.userSpin ?? 0);
    const pitch = STAGE_LOOK_DOWN + (pin?.userTilt ?? 0);

    // Ajusta por la silueta que realmente ve la cámara. Usar la dimensión 3D
    // máxima hacía que la ballena fuera diminuta de frente (su largo apunta a
    // la cámara) y enorme al girarla. La proyección X/Z mantiene el volumen
    // visual estable durante todo el giro.
    const projectedWidth =
      Math.abs(Math.cos(yaw)) * this.stagedNaturalSize.x +
      Math.abs(Math.sin(yaw)) * this.stagedNaturalSize.z;
    const availableHeight = visibleHeight * STAGE_FILL;
    const availableWidth = visibleHeight * camera.aspect * STAGE_FILL_WIDTH;
    // Tope que no depende del giro: el lado mayor en planta, con lo que lo
    // agranda la perspectiva cuando apunta a la cámara (su extremo queda a
    // `distance - s·r` en vez de a `distance`). Despejando s de
    // s·r·d / (d − s·r) ≤ W queda la expresión de abajo.
    const halfWidth = (visibleHeight * camera.aspect * STAGE_MAX_WIDTH) / 2;
    // Inclinado, también el alto puede acabar apuntando a la cámara.
    const radius =
      Math.max(
        this.stagedNaturalSize.x,
        this.stagedNaturalSize.z,
        Math.abs(Math.sin(pitch)) * this.stagedNaturalSize.y,
      ) / 2;
    const perspectiveCap = (halfWidth * distance) / (radius * (distance + halfWidth));
    const fittedScale = Math.min(
      availableHeight / this.stagedNaturalSize.y,
      availableWidth / Math.max(projectedWidth, this.stagedNaturalSize.z * 0.6),
      perspectiveCap,
    );
    if (this.staged.length > 1) {
      this.layoutCompanions(yaw, pitch, availableWidth, availableHeight, halfWidth, distance);
    } else {
      icon.scale.setScalar(fittedScale * (pin?.focusSize ?? 1) * this.scale);
      // El gesto de toque (salto, buceo, correteo) y su salpicón, igual que
      // sobre el mapa: lo aplica el propio pin, que es quien lo lleva.
      if (pin !== undefined) {
        pin.poseIcon(yaw, 0, pitch);
        pin.placeWater(0);
      } else {
        icon.rotation.set(pitch, yaw, 0);
      }
    }
    // El círculo tiene radio 1: queda algo mayor que el animal para que sea
    // fácil acertarle con un dedo y el teléfono en movimiento.
    this.stageHit.scale.setScalar(Math.min(availableWidth, availableHeight) * this.scale * 0.65);
  }

  /**
   * El primer plano de un animal con varios ejemplares: en fila, cada uno a
   * su escala del catálogo (la rana chica, más chica), con los pies a la
   * misma altura. Se encaja la FILA entera con los mismos topes que un
   * animal solo, y el hueco de cada uno se mide con su lado mayor en planta
   * para que girarlos con el dedo no los meta uno dentro del otro.
   */
  private layoutCompanions(
    yaw: number,
    pitch: number,
    availableWidth: number,
    availableHeight: number,
    halfWidth: number,
    distance: number,
  ): void {
    const primary = this.staged[0]!.pin;
    const natural = this.stagedNaturalSize;
    const span = Math.max(natural.x, natural.z);
    // Lo que ocupa de lado cada uno con el giro de AHORA (el mismo cálculo
    // que para un animal solo): girados en tres cuartos ocupan más que su
    // lado mayor, y medirlos con él los solapaba.
    const across = Math.abs(Math.cos(yaw)) * natural.x + Math.abs(Math.sin(yaw)) * natural.z;
    const ratios = this.staged.map(({ pin }) => pin.iconSize / primary.iconSize);
    const lineup = across * (ratios.reduce((sum, k) => sum + k, 0) + STAGE_COMPANION_GAP * (ratios.length - 1));
    // El tope de perspectiva de un animal solo supone que su lado mayor
    // puede apuntar a la cámara. En fila, lo que llega al borde es el
    // extremo de la fila (L/2 de lado) adelantado por el fondo de UN
    // ejemplar (r): s·(L/2)·d ≤ W·(d − s·r), despejando s.
    const depth = span / 2;
    const fitted = Math.min(
      availableHeight / natural.y,
      availableWidth / lineup,
      (halfWidth * distance) / ((lineup / 2) * distance + halfWidth * depth),
    );
    const unit = fitted * primary.focusSize * this.scale;
    let cursor = -(lineup * unit) / 2;
    this.staged.forEach(({ pin, icon, slot, hit }, index) => {
      const k = ratios[index]!;
      const width = across * k * unit;
      slot?.position.set(cursor + width / 2, (-(1 - k) * natural.y * unit) / 2, 0);
      cursor += width + STAGE_COMPANION_GAP * across * unit;
      // La copia ya lleva su proporción dentro (ver copyIcon): aquí, la misma
      // escala para todos.
      icon.scale.setScalar(unit);
      pin.poseIcon(yaw, 0, pitch);
      pin.placeWater(0);
      hit?.scale.setScalar(Math.max(span, natural.y) * k * unit * 0.6);
    });
  }

  /** Los pines de un animal, el principal primero. */
  private pinsOf(id: string): MarkerPin[] {
    return [...this.pins.values()]
      .filter((pin) => pin.modelId === id)
      .sort((a, b) => a.instance - b.instance);
  }

  /** El animal en primer plano: arrastrar en cualquier sitio lo gira a él. */
  get focusedModelId(): string | null {
    return this.stagedIcon === null ? null : this.focusedId;
  }

  onSplash(listener: (modelId: string, strength: number) => void): void {
    this.splashListener = listener;
  }

  onTapSound(listener: (modelId: string) => void): void {
    this.tapSoundListener = listener;
  }

  pulse(id: ModelId, instance?: number): boolean {
    const pins = this.pinsOf(id.value);
    if (instance !== undefined) return pins[instance]?.pulse() ?? false;
    // Sin decir cuál (un toque en la zona general, o la pausa de una
    // narración): el primero que no esté ya a mitad de su gesto.
    const free = pins.find((pin) => !pin.isGesturing);
    return free?.pulse() ?? false;
  }

  clear(): void {
    this.setFocus(null);
    for (const pin of this.pins.values()) {
      this.overlay.remove(pin.group);
      pin.dispose();
    }
    this.pins.clear();
    for (const hotspot of this.hotspots.values()) {
      this.overlay.remove(hotspot.group);
      hotspot.dispose();
    }
    this.hotspots.clear();
    this.poseFilter.reset();
    this.hintTarget = null;
    this.focusedId = null;
    this.stagedIcon = null;
    this.follower.visible = false;
  }

  dispose(): void {
    this.unsubscribeFrame?.();
    this.unsubscribeFrame = null;
    this.clear();
    this.stageHit.geometry.dispose();
    this.slotHitGeometry.dispose();
    this.stageHit.material.dispose();
    this.tapHint.dispose();
    if (this.runtime.isInitialized) {
      this.runtime.mindar.renderer.dispose();
    }
  }

  /**
   * Objetos sobre los que hace raycast el adaptador de interacción,
   * indexados por id. `null` mientras el mapa no está a la vista: no tiene
   * sentido acertarle a un icono que no se está mostrando.
   */
  get pickables(): ReadonlyMap<string, Object3D> | null {
    const map = new Map<string, Object3D>();

    // El animal en primer plano es tocable siempre, esté el mapa a la vista
    // o no: es lo único que se está mirando.
    if (this.focusedId !== null && this.stagedIcon !== null) {
      map.set(this.focusedId, this.stage);
      return map;
    }

    if (!this.follower.visible) return null;

    // Todos los animales son tocables, también los que todavía son un
    // contorno punteado: tocarlos es justo la forma de descubrirlos.
    for (const [key, pin] of this.pins) map.set(key, pin.group);
    for (const [key, hotspot] of this.hotspots) {
      if (hotspot.isActive) map.set(`text:${key}`, hotspot.group);
    }
    return map;
  }

  // ---------------------------------------------------------------- privado

  private mount(): void {
    if (this.mounted) return;

    const mindar = this.runtime.init();
    this.configureRendering();
    addThreePointLighting(mindar.scene);
    addEnvironment(mindar.renderer, mindar.scene);

    this.follower.add(this.overlay);
    this.overlay.add(this.tapHint.group);
    this.follower.visible = false;
    mindar.scene.add(this.follower);

    // El escenario NO cuelga del marcador: por eso el primer plano sigue
    // ahí cuando el mapa se sale de cuadro.
    this.stage.visible = false;
    mindar.scene.add(this.stage);

    this.unsubscribeFrame = this.runtime.onFrame((delta) => this.onFrame(delta));
    this.mounted = true;
  }

  private onFrame(deltaSeconds: number): boolean {
    this.elapsed += deltaSeconds;
    this.followAnchor(deltaSeconds);
    this.measureUnit();
    this.tapHint.advance(deltaSeconds);
    this.placeTapHint();
    this.updateStage(deltaSeconds);
    for (const pin of this.pins.values()) {
      // Con el mapa fuera de cuadro solo se anima el animal que permanece en
      // primer plano. Los demás quedan pausados para ahorrar CPU y batería.
      if (this.follower.visible || pin.isFocused) pin.advance(deltaSeconds, this.elapsed);
    }
    if (this.follower.visible) {
      for (const hotspot of this.hotspots.values()) hotspot.advance(deltaSeconds, this.elapsed);
    }
    // Hay algo que pintar: si no, el runtime se ahorra el render.
    return this.follower.visible || this.stage.visible;
  }

  /**
   * Cuánto mide un ancho de mapa en unidades de mundo.
   *
   * MindAR no trabaja en unidades de mapa: su `postMatrix` escala el
   * contenido por el ancho de la imagen compilada EN PÍXELES (1000 aquí).
   * El primer plano se coloca en anchos de mapa delante de la cámara, así
   * que necesita este número; se guarda el último con el mapa a la vista
   * para que la ficha siga en su sitio aunque el mapa salga de cuadro.
   */
  private measureUnit(): void {
    if (!this.follower.visible) return;
    this.follower.updateMatrixWorld(true);
    const unit = this.follower.getWorldScale(this.tmpUnit).x;
    if (unit > 0) this.unit = unit;
  }

  /**
   * Lleva la mano del tutorial a uno de sus candidatos (animales o puntos
   * de texto).
   *
   * Empieza en el preferido si se ve (la ballena, la primera vez) o, si no,
   * en el más centrado. Se queda en él mientras siga bien a la vista: una
   * mano que salta de uno a otro con cada temblor del pulso no enseña nada.
   * Solo se pasa a otro si el usuario SE ACERCA a él —lo pone en medio de
   * la pantalla y con la cámara cerca— y el suyo queda a un lado, o si el
   * suyo sale de cuadro.
   */
  private placeTapHint(): void {
    const hint = this.hint;
    if (!this.follower.visible || hint === null) return;
    const camera = this.runtime.mindar.camera;
    camera.updateMatrixWorld();
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();

    const objectOf = (id: string): Object3D | undefined =>
      hint.kind === 'animal' ? this.pins.get(id)?.group : this.hotspots.get(id)?.group;
    // Desvío del centro de la pantalla y distancia a la cámara (en anchos
    // de mapa), o null si no está a la vista.
    let distance = 0;
    const offCentreOf = (object: Object3D): number | null => {
      object.getWorldPosition(this.tmpWorld);
      const view = this.tmpView.copy(this.tmpWorld).applyMatrix4(camera.matrixWorldInverse);
      if (view.z > 0) return null;
      distance = view.length() / this.unit;
      const ndc = this.tmpNdc.copy(this.tmpWorld).project(camera);
      if (Math.abs(ndc.x) > HINT_KEEP_NDC || Math.abs(ndc.y) > HINT_KEEP_NDC) return null;
      return Math.hypot(ndc.x, ndc.y);
    };

    let best: string | null = null;
    let bestOffCentre = Number.POSITIVE_INFINITY;
    let bestDistance = Number.POSITIVE_INFINITY;
    let currentOffCentre: number | null = null;
    let preferredOffCentre: number | null = null;
    for (const id of hint.candidates) {
      const object = objectOf(id);
      if (object === undefined) continue;
      const offCentre = offCentreOf(object);
      if (offCentre === null) continue;
      if (id === this.hintTarget) currentOffCentre = offCentre;
      if (id === hint.preferred) preferredOffCentre = offCentre;
      if (offCentre < bestOffCentre) {
        best = id;
        bestOffCentre = offCentre;
        bestDistance = distance;
      }
    }

    if (currentOffCentre === null) {
      // Sin sitio todavía, o el suyo salió de cuadro.
      this.hintTarget = preferredOffCentre !== null ? hint.preferred : best;
    } else if (
      best !== null &&
      best !== this.hintTarget &&
      bestOffCentre < HINT_GRAB_NDC &&
      bestDistance < HINT_APPROACH_DISTANCE &&
      currentOffCentre > HINT_LET_GO_NDC
    ) {
      // Se ha acercado a otro: la mano se va con él.
      this.hintTarget = best;
    }

    const target = this.hintTarget === null ? undefined : objectOf(this.hintTarget);
    this.tapHint.group.visible = this.tapHint.group.visible && target !== undefined;
    if (target !== undefined) this.tapHint.group.position.set(target.position.x, target.position.y, 0);
  }

  /**
   * Copia la pose del anchor al `follower` a través del PoseFilter (One
   * Euro): el temblor del seguimiento y el del pulso se quedan fuera, el
   * gesto de mover el teléfono pasa sin retraso.
   */
  private followAnchor(deltaSeconds: number): void {
    const visible = this.runtime.anchorVisible;
    this.follower.visible = visible;

    if (!visible) {
      this.poseFilter.reset();
      return;
    }

    this.runtime.anchor.group.matrixWorld.decompose(
      this.tmpPosition,
      this.tmpQuaternion,
      this.tmpScale,
    );
    this.poseFilter.update(
      this.tmpPosition,
      this.tmpQuaternion,
      this.tmpScale,
      deltaSeconds,
      this.stabilization,
    );
    this.follower.position.copy(this.poseFilter.position);
    this.follower.quaternion.copy(this.poseFilter.quaternion);
    this.follower.scale.copy(this.poseFilter.scale);
  }

  private configureRendering(): void {
    const renderer = this.runtime.mindar.renderer;
    // Tone mapping fílmico: evita que los blancos del modelo se "quemen"
    // contra la imagen real de la cámara.
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
  }
}
