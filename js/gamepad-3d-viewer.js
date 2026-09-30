/**
 * SeeMyGame - Gamepad 3D Viewer (Three.js + GLTF + Reactive Materials + On-Demand Render Loop)
 * Renderizador WebGL de alta fidelidade para visualização e calibração de gamepads em 3D real.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createGamepadModel } from './gamepad-model-builder.js';

export class Gamepad3DViewer {
  constructor(options = {}) {
    this.container = options.container || null;
    this.canvas = options.canvas || null;
    this.renderer = options.renderer || null;
    this.modelUrl = options.modelUrl || 'css/assets/gamepad.glb';
    this.enableMouseTracking = options.enableMouseTracking !== false;

    this.scene = null;
    this.camera = null;
    this.controllerGroup = null;
    this.isInitialized = false;
    this.isDestroyed = false;
    this.isRendering = false;
    this.isPaused = false;
    this.animId = null;
    this.settleFrames = 0;

    // Subpartes das cabeças dos analógicos (cúpula, prato, aro, ranhuras)
    this.stickLCapParts = [];
    this.stickRCapParts = [];
    this._lastInputs = null;

    // Peças animáveis indexadas
    this.parts = {
      stickL: null,
      stickR: null,
      dpadUp: null,
      dpadDown: null,
      dpadLeft: null,
      dpadRight: null,
      dpadGroup: null,
      buttonA: null,
      buttonB: null,
      buttonX: null,
      buttonY: null,
      bumperLB: null,
      bumperRB: null,
      triggerLT: null,
      triggerRT: null,
      buttonBack: null,
      buttonStart: null,
      buttonGuide: null,
      guideDisc: null,
      guideRing: null,
      body: null,
      shadow: null
    };

    // Posições e rotações originais de descanso
    this.initialTransforms = new Map();

    // Cache de materiais para feedback emissivo dinâmico sem interferência mútua
    this.partMaterials = new Map();

    // Estado de tracking do mouse
    this.baseRotation = { x: 0.36, y: -0.05, z: 0 };
    this.targetRotation = { x: 0.36, y: -0.05, z: 0 };
    this.currentRotation = { x: 0.36, y: -0.05, z: 0 };
    this.mouse = { x: 0, y: 0, isHovering: false };
    this._renderedWidth = 0;
    this._renderedHeight = 0;
    this.resizeObserver = null;

    // Estado do rumble
    this.rumbleIntensity = 0;
    this.rumbleDecay = 0.92;

    // Estado de conexão e atividade
    this.isConnected = true;
    this.hasActiveInputs = false;

    // Handlers para remoção de listeners
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onMouseEnter = this._onMouseEnter.bind(this);
    this._onMouseLeave = this._onMouseLeave.bind(this);
    this._onResize = this._onResize.bind(this);
    this._renderLoop = this._renderLoop.bind(this);
  }

  /**
   * Inicializa o renderizador WebGL, cena, luzes e câmera
   */
  init() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return false;
    if (this.isInitialized) return true;
    if (this.isDestroyed) return false;

    try {
      if (!this.canvas && this.container) {
        this.canvas = this.container.querySelector('canvas') || document.createElement('canvas');
        if (!this.canvas.parentElement) {
          this.canvas.className = 'gamepad-3d-canvas';
          this.container.appendChild(this.canvas);
        }
      }

      if (!this.canvas && !this.renderer) return false;

      // Criação ou reutilização do WebGLRenderer com antialiasing e fundo transparente
      if (!this.renderer && this.canvas) {
        this.renderer = new THREE.WebGLRenderer({
          canvas: this.canvas,
          alpha: true,
          antialias: true,
          powerPreference: 'high-performance'
        });
      }

      if (!this.renderer) return false;

      if (this.renderer.setPixelRatio) {
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      }
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.15;

      // Cena 3D
      this.scene = new THREE.Scene();

      // Câmera Perspectiva
      const dims = this._getEffectiveDimensions();
      const aspect = dims.width / (dims.height || 1);
      this.camera = new THREE.PerspectiveCamera(34, aspect, 0.1, 100);
      this.camera.position.set(0, 2.35, 3.35);
      this.camera.lookAt(0, -0.05, 0.08);

      // Configuração de Iluminação Estúdio Gamer (Key Light + Rim/Neon Accents)
      this._setupLighting();

      // Contêiner principal do controle
      this.controllerGroup = new THREE.Group();
      this.controllerGroup.name = 'ControllerPivot';
      this.controllerGroup.rotation.set(this.baseRotation.x, this.baseRotation.y, this.baseRotation.z);
      this.scene.add(this.controllerGroup);

      // Sombra de contato no chão
      this._setupGroundShadow();

      // Carrega o modelo GLB (com fallback procedural instantâneo)
      this._loadModel();

      // Setup de mouse tracking no container e canvas
      this._setupMouseTracking();

      this._onResize(true);
      window.addEventListener('resize', this._onResize);

      if (typeof ResizeObserver !== 'undefined') {
        const observeTarget = this.container || (this.canvas && this.canvas.parentElement) || this.canvas;
        if (observeTarget) {
          try {
            this.resizeObserver = new ResizeObserver((entries) => {
              for (const entry of entries) {
                const cr = entry.contentRect;
                if (!cr || cr.width > 0 || cr.height > 0) {
                  this._onResize(false);
                  break;
                }
              }
            });
            this.resizeObserver.observe(observeTarget);
          } catch (e) {
            console.warn('[Gamepad3DViewer] Falha ao inicializar ResizeObserver:', e);
          }
        }
      }

      this.isInitialized = true;
      this.requestRender();
      return true;
    } catch (err) {
      console.warn('[Gamepad3DViewer] WebGL indisponível ou falha na inicialização:', err);
      return false;
    }
  }

  _setupLighting() {
    // Luz ambiente para visibilidade geral
    const ambientLight = new THREE.AmbientLight(0x404866, 1.8);
    this.scene.add(ambientLight);

    // Key Light branca direcional frontal
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.8);
    keyLight.position.set(2.5, 4.2, 3.6);
    this.scene.add(keyLight);

    // Rim Light Roxa Neon (Gamer Accent esquerda)
    const rimPurple = new THREE.DirectionalLight(0xc084fc, 3.8);
    rimPurple.position.set(-4.5, 2.0, -2.5);
    this.scene.add(rimPurple);

    // Fill Light Azul Ciano (Gamer Accent direita)
    const fillCyan = new THREE.DirectionalLight(0x22d3ee, 3.5);
    fillCyan.position.set(4.5, 1.8, -2.0);
    this.scene.add(fillCyan);

    // Luz de preenchimento frontal suave para destacar chanfros e detalhes
    const frontFill = new THREE.PointLight(0xa5b4fc, 1.8, 12);
    frontFill.position.set(0, -0.4, 3.0);
    this.scene.add(frontFill);
  }

  _setupGroundShadow() {
    const shadowGeo = new THREE.PlaneGeometry(3.8, 2.6);
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const grad = ctx.createRadialGradient(128, 128, 20, 128, 128, 120);
      grad.addColorStop(0, 'rgba(0, 0, 0, 0.7)');
      grad.addColorStop(0.55, 'rgba(0, 0, 0, 0.3)');
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 256, 256);
    }
    const texture = new THREE.CanvasTexture(canvas);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false
    });
    this.parts.shadow = new THREE.Mesh(shadowGeo, shadowMat);
    this.parts.shadow.rotation.x = -Math.PI / 2;
    this.parts.shadow.position.set(0, -0.68, 0.2);
    this.scene.add(this.parts.shadow);
  }

  _disposeHierarchy(rootObj) {
    if (!rootObj) return;
    const disposedGeos = new Set();
    const disposedMats = new Set();
    const disposedTexs = new Set();
    rootObj.traverse((obj) => {
      if (obj.geometry && typeof obj.geometry.dispose === 'function' && !disposedGeos.has(obj.geometry)) {
        disposedGeos.add(obj.geometry);
        obj.geometry.dispose();
      }
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const mat of mats) {
          if (!mat || disposedMats.has(mat)) continue;
          disposedMats.add(mat);
          for (const key of Object.keys(mat)) {
            const val = mat[key];
            if (val && typeof val.dispose === 'function' && !disposedTexs.has(val)) {
              disposedTexs.add(val);
              val.dispose();
            }
          }
          if (typeof mat.dispose === 'function') {
            mat.dispose();
          }
        }
      }
    });
  }

  _loadModel() {
    // 1. Instanciação inicial imediata do modelo procedural (0ms de latência)
    const proceduralModel = createGamepadModel();
    this._attachModel(proceduralModel);

    // 2. Se houver URL do GLB e suporte a GLTFLoader, tenta carregar o GLB externo
    if (this.modelUrl && typeof GLTFLoader !== 'undefined') {
      try {
        const loader = new GLTFLoader();
        loader.load(
          this.modelUrl,
          (gltf) => {
            if (this.isDestroyed || !this.controllerGroup) {
              if (gltf?.scene) this._disposeHierarchy(gltf.scene);
              return;
            }
            if (gltf?.scene) {
              while (this.controllerGroup.children.length > 0) {
                const child = this.controllerGroup.children[0];
                this.controllerGroup.remove(child);
                this._disposeHierarchy(child);
              }
              this._attachModel(gltf.scene);
              this._lastInputs = null;
              if (this._cachedRawInputs) {
                this.updateInputs(this._cachedRawInputs);
              }
              this.requestRender();
            }
          },
          undefined,
          () => {
            // Mantém o modelo procedural silenciosamente em caso de erro na requisição GLB
          }
        );
      } catch (e) {
        // Fallback procedural
      }
    }
  }

  _attachModel(model) {
    this.controllerGroup.add(model);
    this.initialTransforms.clear();
    this.partMaterials.clear();
    this._lastInputs = null;

    // Mapeamento e cache de peças interativas
    const find = (name) => model.getObjectByName(name) || null;

    this.parts.stickL = find('Stick_L');
    this.parts.stickR = find('Stick_R');
    this.parts.dpadGroup = find('Dpad_Group');
    this.parts.dpadUp = find('Dpad_Up');
    this.parts.dpadDown = find('Dpad_Down');
    this.parts.dpadLeft = find('Dpad_Left');
    this.parts.dpadRight = find('Dpad_Right');
    this.parts.buttonA = find('Button_A');
    this.parts.buttonB = find('Button_B');
    this.parts.buttonX = find('Button_X');
    this.parts.buttonY = find('Button_Y');
    this.parts.bumperLB = find('Bumper_LB');
    this.parts.bumperRB = find('Bumper_RB');
    this.parts.triggerLT = find('Trigger_LT');
    this.parts.triggerRT = find('Trigger_RT');
    this.parts.buttonBack = find('Button_Back');
    this.parts.buttonStart = find('Button_Start');
    this.parts.buttonGuide = find('Button_Guide');
    this.parts.guideDisc = find('Button_Guide_Disc');
    this.parts.guideRing = find('Button_Guide_Ring');
    this.parts.body = find('Body');

    // Registra posições e rotações iniciais e prepara materiais independentes
    for (const key of Object.keys(this.parts)) {
      const obj = this.parts[key];
      if (obj && obj.position && obj.rotation) {
        this.initialTransforms.set(obj, {
          pos: obj.position.clone(),
          rot: obj.rotation.clone()
        });
      }
      if (obj) {
        this._preparePartMaterials(obj);
      }
    }

    // Registra subpartes da cúpula do analógico para depressão unificada (Cap, Dish, Rim, Grooves)
    this.stickLCapParts = [];
    if (this.parts.stickL) {
      this.parts.stickL.children.forEach((child) => {
        if (child.name !== 'Stick_L_Ball' && child.name !== 'Stick_L_Stem') {
          this.stickLCapParts.push(child);
          this.initialTransforms.set(child, { pos: child.position.clone(), rot: child.rotation.clone() });
        }
      });
    }

    this.stickRCapParts = [];
    if (this.parts.stickR) {
      this.parts.stickR.children.forEach((child) => {
        if (child.name !== 'Stick_R_Ball' && child.name !== 'Stick_R_Stem') {
          this.stickRCapParts.push(child);
          this.initialTransforms.set(child, { pos: child.position.clone(), rot: child.rotation.clone() });
        }
      });
    }
  }

  _preparePartMaterials(obj) {
    if (!obj) return;
    const records = [];
    obj.traverse((child) => {
      if (child.isMesh && child.material) {
        if (Array.isArray(child.material)) {
          child.material = child.material.map((m) => {
            if (!m.__viewerCloned) {
              const clone = m.clone();
              clone.__viewerCloned = true;
              return clone;
            }
            return m;
          });
          for (const m of child.material) {
            records.push({
              material: m,
              baseEmissive: m.emissive ? m.emissive.clone() : new THREE.Color(0x000000),
              baseIntensity: typeof m.emissiveIntensity === 'number' ? m.emissiveIntensity : 0.0
            });
          }
        } else {
          if (!child.material.__viewerCloned) {
            child.material = child.material.clone();
            child.material.__viewerCloned = true;
          }
          records.push({
            material: child.material,
            baseEmissive: child.material.emissive ? child.material.emissive.clone() : new THREE.Color(0x000000),
            baseIntensity: typeof child.material.emissiveIntensity === 'number' ? child.material.emissiveIntensity : 0.0
          });
        }
      }
    });
    if (records.length > 0) {
      this.partMaterials.set(obj, records);
    }
  }

  _setPartEmissive(obj, active, highlightColor = null, boostIntensity = null) {
    if (!obj) return;
    const records = this.partMaterials.get(obj);
    if (!records) return;

    for (const { material, baseEmissive, baseIntensity } of records) {
      if (!material || !material.emissive) continue;
      if (active) {
        if (highlightColor !== null) {
          material.emissive.set(highlightColor);
        } else {
          material.emissive.copy(baseEmissive);
        }
        material.emissiveIntensity = boostIntensity !== null
          ? boostIntensity
          : (baseIntensity > 0 ? baseIntensity * 2.8 + 0.8 : 1.8);
      } else {
        material.emissive.copy(baseEmissive);
        material.emissiveIntensity = baseIntensity;
      }
    }
  }

  _setupMouseTracking() {
    if (!this.enableMouseTracking) return;

    const targetEl = this.container || this.canvas;
    if (!targetEl) return;

    targetEl.addEventListener('mousemove', this._onMouseMove);
    targetEl.addEventListener('mouseenter', this._onMouseEnter);
    targetEl.addEventListener('mouseleave', this._onMouseLeave);
  }

  _onMouseMove(e) {
    const targetEl = this.container || this.canvas;
    if (!targetEl) return;

    const rect = targetEl.getBoundingClientRect();
    const nx = rect.width > 0 ? ((e.clientX - rect.left) / rect.width) * 2 - 1 : 0;
    const ny = rect.height > 0 ? ((e.clientY - rect.top) / rect.height) * 2 - 1 : 0;

    this.mouse.x = Math.max(-1, Math.min(1, nx));
    this.mouse.y = Math.max(-1, Math.min(1, ny));
    this.mouse.isHovering = true;

    // Inclinação suave do controle acompanhando a posição do cursor (Pitch, Yaw, Roll)
    this.targetRotation.y = this.baseRotation.y + this.mouse.x * 0.44;
    this.targetRotation.x = this.baseRotation.x - this.mouse.y * 0.32;
    this.targetRotation.z = -this.mouse.x * 0.08;

    this.isPaused = false;
    this.requestRender();
  }

  _onMouseEnter() {
    this.isPaused = false;
    this.mouse.isHovering = true;
    this.requestRender();
  }

  _onMouseLeave() {
    this.mouse.isHovering = false;
    this.targetRotation.x = this.baseRotation.x;
    this.targetRotation.y = this.baseRotation.y;
    this.targetRotation.z = this.baseRotation.z;
    this.requestRender();
  }

  /**
   * Verifica se o elemento HTML (ou algum ancestral) está oculto no DOM
   */
  _isDomHidden() {
    if (typeof window !== 'undefined') {
      const targetEl = this.canvas || this.container;
      if (!targetEl) return false;

      if (typeof targetEl.checkVisibility === 'function') {
        try {
          if (!targetEl.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true })) {
            return true;
          }
        } catch (_) {}
      }

      let el = targetEl;
      while (el && el !== document.body && el !== document.documentElement) {
        if (typeof window.getComputedStyle === 'function') {
          const style = window.getComputedStyle(el);
          if (style && (style.display === 'none' || style.visibility === 'hidden')) {
            return true;
          }
        }
        if (el.style && (el.style.display === 'none' || el.style.visibility === 'hidden')) {
          return true;
        }
        el = el.parentElement;
      }
    }
    return false;
  }

  /**
   * Mede dimensões reais do contêiner/canvas ou retorna fallback anatômico 420x250 (aspecto 1.68)
   */
  _getEffectiveDimensions() {
    let width = 0;
    let height = 0;
    let isVisible = false;

    const isDomHidden = this._isDomHidden();

    if (!isDomHidden && this.canvas) {
      if (this.canvas.clientWidth > 0 && this.canvas.clientHeight > 0) {
        width = this.canvas.clientWidth;
        height = this.canvas.clientHeight;
        isVisible = true;
      } else if (typeof this.canvas.getBoundingClientRect === 'function') {
        const rect = this.canvas.getBoundingClientRect();
        if (rect && rect.width > 0 && rect.height > 0) {
          width = Math.round(rect.width);
          height = Math.round(rect.height);
          isVisible = true;
        }
      }
    }

    if (!isVisible && !isDomHidden) {
      const containerEl = this.container || (this.canvas && this.canvas.parentElement);
      if (containerEl) {
        if (containerEl.clientWidth > 0 && containerEl.clientHeight > 0) {
          width = containerEl.clientWidth;
          height = containerEl.clientHeight;
          isVisible = true;
        } else if (typeof containerEl.getBoundingClientRect === 'function') {
          const rect = containerEl.getBoundingClientRect();
          if (rect && rect.width > 0 && rect.height > 0) {
            width = Math.round(rect.width);
            height = Math.round(rect.height);
            isVisible = true;
          }
        }
      }
    }

    if (!isVisible && this.canvas) {
      const attrW = parseInt(this.canvas.getAttribute?.('width'), 10);
      const attrH = parseInt(this.canvas.getAttribute?.('height'), 10);
      if (Number.isFinite(attrW) && attrW > 0 && Number.isFinite(attrH) && attrH > 0) {
        width = attrW;
        height = attrH;
      }
    }

    if (!width || !height || width <= 0 || height <= 0) {
      width = 420;
      height = 250;
    }

    return { width, height, isVisible };
  }

  _onResize(force = false) {
    if (!this.canvas || !this.renderer || !this.camera) return;

    const dims = this._getEffectiveDimensions();
    const width = dims.width;
    const height = dims.height;

    const isForced = force === true;
    if (isForced || this._renderedWidth !== width || this._renderedHeight !== height) {
      this._renderedWidth = width;
      this._renderedHeight = height;
      if (this.renderer.setSize) {
        this.renderer.setSize(width, height, false);
      }
      this.camera.aspect = width / (height || 1);
      this.camera.updateProjectionMatrix();
      this.requestRender();
    }
  }

  /**
   * Dispara feedback visual de vibração física do controle (Rumble)
   */
  triggerRumble(intensity = 1.0) {
    const val = Number(intensity);
    if (!Number.isFinite(val) || val <= 0) return;
    this.rumbleIntensity = Math.min(1.0, Math.max(this.rumbleIntensity, val));
    this.requestRender();
  }

  /**
   * Verifica se o visualizador está pausado ou o elemento HTML (ou algum ancestral) está oculto
   */
  _isElementHidden() {
    if (this.isPaused) return true;
    return this._isDomHidden();
  }

  /**
   * Solicita execução ativa do loop de renderização (acorda da ociosidade 0 FPS)
   */
  requestRender() {
    if (this.isDestroyed || !this.isInitialized || !this.renderer || this._isElementHidden()) return;
    this.settleFrames = 6;
    if (!this.isRendering) {
      this.isRendering = true;
      this.animId = requestAnimationFrame(this._renderLoop);
    }
  }

  /**
   * Inicia o visualizador / acorda o loop
   */
  start() {
    this.isPaused = false;
    this._lastInputs = null;
    this._onResize(true);
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        if (!this.isDestroyed && !this.isPaused) {
          this._onResize(true);
        }
      });
    }
    this.requestRender();
  }

  /**
   * Para o loop imediatamente (0 FPS)
   */
  stop() {
    this.isPaused = true;
    this.isRendering = false;
    if (this.animId !== null) {
      cancelAnimationFrame(this.animId);
      this.animId = null;
    }
  }

  /**
   * Atualiza o estado visual das peças 3D com dados reais do Gamepad
   */
  updateInputs(gamepadData = {}) {
    if (!this.isInitialized || this.isDestroyed || this._isElementHidden()) return;
    const data = gamepadData || {};
    this._cachedRawInputs = data;

    const rawAxes = Array.isArray(data.axes) ? data.axes : [0, 0, 0, 0];
    const buttons = Array.isArray(data.buttons) ? data.buttons : [];

    const getBtn = (idx) => {
      const b = buttons[idx];
      if (typeof b === 'object' && b !== null) {
        const pressed = Boolean(b.pressed);
        let val = typeof b.value === 'number' ? b.value : (pressed ? 1.0 : 0.0);
        if (pressed && val <= 0) val = 1.0;
        return { pressed, value: val };
      }
      const val = Number(b || 0);
      return { pressed: val > 0.1, value: val };
    };

    const prevConnected = this.isConnected;
    if (data.connected !== undefined) {
      this.isConnected = Boolean(data.connected);
    } else if (buttons.length > 0) {
      this.isConnected = true;
    }

    // 1. Filtragem com deadzone radial anatômica nos analógicos
    const sanitizeAxis = (val) => {
      const n = Number(val);
      return Number.isFinite(n) ? Math.max(-1.0, Math.min(1.0, n)) : 0.0;
    };

    const STICK_DEADZONE = 0.06;
    let lx = sanitizeAxis(rawAxes[0]);
    let ly = sanitizeAxis(rawAxes[1]);
    const lMag = Math.hypot(lx, ly);
    if (lMag <= STICK_DEADZONE) {
      lx = 0;
      ly = 0;
    } else {
      const clampedMag = Math.min(1.0, lMag);
      const scaledMag = (clampedMag - STICK_DEADZONE) / (1.0 - STICK_DEADZONE);
      lx = (lx / lMag) * scaledMag;
      ly = (ly / lMag) * scaledMag;
    }

    let rx = sanitizeAxis(rawAxes[2]);
    let ry = sanitizeAxis(rawAxes[3]);
    const rMag = Math.hypot(rx, ry);
    if (rMag <= STICK_DEADZONE) {
      rx = 0;
      ry = 0;
    } else {
      const clampedMag = Math.min(1.0, rMag);
      const scaledMag = (clampedMag - STICK_DEADZONE) / (1.0 - STICK_DEADZONE);
      rx = (rx / rMag) * scaledMag;
      ry = (ry / rMag) * scaledMag;
    }

    // 2. Filtragem linear com deadzone nos gatilhos
    const TRIGGER_DEADZONE = 0.03;
    const rawLt = Math.max(0, Math.min(1, sanitizeAxis(getBtn(6).value)));
    const ltVal = rawLt <= TRIGGER_DEADZONE ? 0 : (rawLt - TRIGGER_DEADZONE) / (1.0 - TRIGGER_DEADZONE);

    const rawRt = Math.max(0, Math.min(1, sanitizeAxis(getBtn(7).value)));
    const rtVal = rawRt <= TRIGGER_DEADZONE ? 0 : (rawRt - TRIGGER_DEADZONE) / (1.0 - TRIGGER_DEADZONE);

    const currentAxes = [lx, ly, rx, ry];

    // Input diffing: detecta se os dados de entrada mudaram em relação ao frame anterior
    let inputsChanged = !this._lastInputs || this.isConnected !== prevConnected;
    if (!inputsChanged && this._lastInputs) {
      const prevAxes = this._lastInputs.axes;
      for (let i = 0; i < currentAxes.length; i++) {
        if (Math.abs(currentAxes[i] - (prevAxes[i] || 0)) > 0.005) {
          inputsChanged = true;
          break;
        }
      }
      if (!inputsChanged) {
        const prevBtns = this._lastInputs.buttons;
        if (prevBtns.length !== buttons.length) {
          inputsChanged = true;
        } else {
          for (let i = 0; i < buttons.length; i++) {
            const b = getBtn(i);
            const pb = prevBtns[i];
            if (b.pressed !== pb.pressed || Math.abs(b.value - pb.value) > 0.01) {
              inputsChanged = true;
              break;
            }
          }
        }
      }
    }

    // Se as entradas não mudaram, mantém repouso a 0 FPS sem consumir GPU/CPU
    if (!inputsChanged) {
      return;
    }

    const MAX_STICK_ANGLE = 0.42; // ~24 graus
    const MAX_TRIGGER_ANGLE = 0.32; // ~18 graus
    const PRESS_DEPTH = 0.08;

    let hasActive = false;

    // 1. Analógico Esquerdo (Stick_L) com limite físico circular
    if (this.parts.stickL) {
      const init = this.initialTransforms.get(this.parts.stickL);
      if (init) {
        const l3Pressed = getBtn(10).pressed;
        if (Math.abs(lx) > 0.02 || Math.abs(ly) > 0.02 || l3Pressed) {
          hasActive = true;
        }

        // +ly inclina para frente (-Z) ao empurrar analógico para cima (ly < 0)
        this.parts.stickL.rotation.x = init.rot.x + ly * MAX_STICK_ANGLE;
        this.parts.stickL.rotation.z = init.rot.z - lx * MAX_STICK_ANGLE;
        this.parts.stickL.position.y = init.pos.y - (l3Pressed ? 0.04 : 0);
        this._setPartEmissive(this.parts.stickL, l3Pressed, 0x06b6d4);

        if (this.stickLCapParts && this.stickLCapParts.length > 0) {
          const capDeltaY = l3Pressed ? 0.04 : 0;
          for (const part of this.stickLCapParts) {
            const capInit = this.initialTransforms.get(part);
            if (capInit) {
              part.position.y = capInit.pos.y - capDeltaY;
            }
          }
        }
      }
    }

    // 2. Analógico Direito (Stick_R) com limite físico circular
    if (this.parts.stickR) {
      const init = this.initialTransforms.get(this.parts.stickR);
      if (init) {
        const r3Pressed = getBtn(11).pressed;
        if (Math.abs(rx) > 0.02 || Math.abs(ry) > 0.02 || r3Pressed) {
          hasActive = true;
        }

        this.parts.stickR.rotation.x = init.rot.x + ry * MAX_STICK_ANGLE;
        this.parts.stickR.rotation.z = init.rot.z - rx * MAX_STICK_ANGLE;
        this.parts.stickR.position.y = init.pos.y - (r3Pressed ? 0.04 : 0);
        this._setPartEmissive(this.parts.stickR, r3Pressed, 0x06b6d4);

        if (this.stickRCapParts && this.stickRCapParts.length > 0) {
          const capDeltaY = r3Pressed ? 0.04 : 0;
          for (const part of this.stickRCapParts) {
            const capInit = this.initialTransforms.get(part);
            if (capInit) {
              part.position.y = capInit.pos.y - capDeltaY;
            }
          }
        }
      }
    }

    // 3. Gatilhos Analógicos Progressivos (LT / RT) - Rotação por dobradiça e brilho proporcional
    if (this.parts.triggerLT) {
      const init = this.initialTransforms.get(this.parts.triggerLT);
      if (init) {
        if (ltVal > 0.02) hasActive = true;
        this.parts.triggerLT.rotation.x = init.rot.x - ltVal * MAX_TRIGGER_ANGLE;
        this._setPartEmissive(this.parts.triggerLT, ltVal > 0.05, 0x06b6d4, ltVal * 1.8);
      }
    }

    if (this.parts.triggerRT) {
      const init = this.initialTransforms.get(this.parts.triggerRT);
      if (init) {
        if (rtVal > 0.02) hasActive = true;
        this.parts.triggerRT.rotation.x = init.rot.x - rtVal * MAX_TRIGGER_ANGLE;
        this._setPartEmissive(this.parts.triggerRT, rtVal > 0.05, 0x06b6d4, rtVal * 1.8);
      }
    }

    // Helper para botões que afundam e modulam emissivo
    const updateDepress = (obj, pressed, glowColor = null) => {
      if (!obj) return;
      if (pressed) hasActive = true;
      const init = this.initialTransforms.get(obj);
      if (init) {
        obj.position.y = init.pos.y - (pressed ? PRESS_DEPTH : 0);
      }
      this._setPartEmissive(obj, pressed, glowColor);
    };

    // 4. Bumpers dos Ombros (LB / RB)
    updateDepress(this.parts.bumperLB, getBtn(4).pressed, 0x06b6d4);
    updateDepress(this.parts.bumperRB, getBtn(5).pressed, 0x06b6d4);

    // 5. Botões de Ação ABXY (depressão física + modulação de brilho)
    updateDepress(this.parts.buttonA, getBtn(0).pressed);
    updateDepress(this.parts.buttonB, getBtn(1).pressed);
    updateDepress(this.parts.buttonX, getBtn(2).pressed);
    updateDepress(this.parts.buttonY, getBtn(3).pressed);

    // 6. Botões do Sistema (Back, Start, Guide)
    updateDepress(this.parts.buttonBack, getBtn(8).pressed, 0x38bdf8);
    updateDepress(this.parts.buttonStart, getBtn(9).pressed, 0x38bdf8);

    const guidePressed = getBtn(16).pressed;
    if (this.parts.buttonGuide) {
      if (guidePressed) hasActive = true;
      const init = this.initialTransforms.get(this.parts.buttonGuide);
      if (init) {
        this.parts.buttonGuide.position.y = init.pos.y - (guidePressed ? PRESS_DEPTH : 0);
      }
    }

    // 7. D-Pad Direcional (depressão por braço + inclinação de conjunto)
    const up = getBtn(12).pressed;
    const down = getBtn(13).pressed;
    const left = getBtn(14).pressed;
    const right = getBtn(15).pressed;

    updateDepress(this.parts.dpadUp, up, 0x60a5fa);
    updateDepress(this.parts.dpadDown, down, 0x60a5fa);
    updateDepress(this.parts.dpadLeft, left, 0x60a5fa);
    updateDepress(this.parts.dpadRight, right, 0x60a5fa);

    if (this.parts.dpadGroup) {
      const init = this.initialTransforms.get(this.parts.dpadGroup);
      if (init) {
        const u = up ? 1 : 0;
        const d = down ? 1 : 0;
        const l = left ? 1 : 0;
        const r = right ? 1 : 0;
        // Pressionar Cima (u=1) deprime o braço superior em -Z (rotação negativa em X)
        this.parts.dpadGroup.rotation.x = init.rot.x + (d - u) * 0.12;
        this.parts.dpadGroup.rotation.z = init.rot.z + (l - r) * 0.12;
      }
    }

    // 8. Reatividade do LED central Guide / Nexus ring à conexão e inputs
    const targetGuide = this.parts.guideDisc || this.parts.buttonGuide;
    if (targetGuide) {
      if (!this.isConnected) {
        this._setPartEmissive(targetGuide, true, 0x334155, 0.1);
      } else if (guidePressed) {
        this._setPartEmissive(targetGuide, true, 0xc084fc, 2.5);
      } else if (hasActive) {
        this._setPartEmissive(targetGuide, true, null, 1.6);
      } else {
        this._setPartEmissive(targetGuide, false);
      }
    }

    if (this.parts.guideRing) {
      if (!this.isConnected) {
        this._setPartEmissive(this.parts.guideRing, true, 0x1e293b, 0.05);
      } else if (guidePressed || hasActive) {
        this._setPartEmissive(this.parts.guideRing, true, 0x22d3ee, 1.8);
      } else {
        this._setPartEmissive(this.parts.guideRing, false);
      }
    }

    this.hasActiveInputs = hasActive;

    // Cache do estado para comparativo no próximo frame
    this._lastInputs = {
      axes: currentAxes,
      buttons: buttons.map((_, i) => getBtn(i))
    };

    this.requestRender();
  }

  /**
   * Render loop inteligente com estratégia On-Demand / Idle-Throttled
   */
  _renderLoop(timestamp) {
    if (!this.isRendering || this._isElementHidden()) {
      this.isRendering = false;
      this.animId = null;
      return;
    }
    if (!this.renderer || !this.scene || !this.camera || !this.controllerGroup) {
      this.stop();
      return;
    }

    const time = (timestamp || performance.now()) * 0.001;

    // 1. Mouse tracking interpolação suave (Lerp)
    const wasRumbling = this.rumbleIntensity > 0.001;
    if (!wasRumbling) {
      this.currentRotation.x = this.controllerGroup.rotation.x;
      this.currentRotation.y = this.controllerGroup.rotation.y;
      this.currentRotation.z = this.controllerGroup.rotation.z;
    }

    const dx = this.targetRotation.x - this.currentRotation.x;
    const dy = this.targetRotation.y - this.currentRotation.y;
    const dz = this.targetRotation.z - this.currentRotation.z;
    const rotDist = Math.hypot(dx, dy, dz);

    if (rotDist > 0.0005) {
      this.currentRotation.x += dx * 0.10;
      this.currentRotation.y += dy * 0.10;
      this.currentRotation.z += dz * 0.10;
    } else {
      this.currentRotation.x = this.targetRotation.x;
      this.currentRotation.y = this.targetRotation.y;
      this.currentRotation.z = this.targetRotation.z;
    }

    this.controllerGroup.rotation.x = this.currentRotation.x;
    this.controllerGroup.rotation.y = this.currentRotation.y;
    this.controllerGroup.rotation.z = this.currentRotation.z;

    // 2. Simulação física de motores de vibração (Rumble) com harmônicos duplos e decaimento limpo
    let isRumbling = false;
    if (this.rumbleIntensity > 0.001) {
      isRumbling = true;
      const shakeX = (Math.sin(time * 78) * 0.035 + Math.sin(time * 145) * 0.018) * this.rumbleIntensity;
      const shakeY = (Math.cos(time * 84) * 0.025 + Math.sin(time * 160) * 0.012) * this.rumbleIntensity;
      const shakeRot = Math.sin(time * 95) * 0.025 * this.rumbleIntensity;

      this.controllerGroup.position.x = shakeX;
      this.controllerGroup.position.y = shakeY;
      this.controllerGroup.rotation.z = this.currentRotation.z + shakeRot;

      this.rumbleIntensity *= this.rumbleDecay;
      if (this.rumbleIntensity <= 0.001) {
        this.rumbleIntensity = 0;
        this.controllerGroup.position.x = 0;
        this.controllerGroup.position.y = 0;
        this.controllerGroup.rotation.z = this.currentRotation.z;
      }
    } else {
      this.rumbleIntensity = 0;
      this.controllerGroup.position.x = 0;
      this.controllerGroup.position.y = 0;
      this.controllerGroup.rotation.z = this.currentRotation.z;
    }

    // 3. Renderiza o frame no canvas WebGL
    this.renderer.render(this.scene, this.camera);

    // 4. Estratégia de repouso: se não há hover, rotação estabilizou e sem rumble
    const isRotating = rotDist > 0.0005;
    const isHovering = Boolean(this.mouse.isHovering);
    const activeActivity = isHovering || isRotating || isRumbling;

    if (activeActivity) {
      this.settleFrames = 6;
    } else if (this.settleFrames > 0) {
      this.settleFrames--;
    }

    if (activeActivity || this.settleFrames > 0) {
      this.animId = requestAnimationFrame(this._renderLoop);
    } else {
      // Repouso ocioso completo (0 FPS para eliminar consumo de GPU)
      this.isRendering = false;
      this.animId = null;
    }
  }

  /**
   * Destruição completa de recursos, buffers, shaders e WebGLContext
   */
  destroy() {
    this.stop();
    if (this.resizeObserver) {
      try {
        this.resizeObserver.disconnect();
      } catch (_) {}
      this.resizeObserver = null;
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this._onResize);
    }

    const targetEl = this.container || this.canvas;
    if (targetEl) {
      targetEl.removeEventListener('mousemove', this._onMouseMove);
      targetEl.removeEventListener('mouseenter', this._onMouseEnter);
      targetEl.removeEventListener('mouseleave', this._onMouseLeave);
    }

    if (this.parts.shadow) {
      if (this.scene) {
        this.scene.remove(this.parts.shadow);
      }
      if (this.parts.shadow.material) {
        if (this.parts.shadow.material.map && typeof this.parts.shadow.material.map.dispose === 'function') {
          this.parts.shadow.material.map.dispose();
        }
        if (typeof this.parts.shadow.material.dispose === 'function') {
          this.parts.shadow.material.dispose();
        }
      }
      if (this.parts.shadow.geometry && typeof this.parts.shadow.geometry.dispose === 'function') {
        this.parts.shadow.geometry.dispose();
      }
      this.parts.shadow = null;
    }

    if (this.scene) {
      this._disposeHierarchy(this.scene);
    }

    this.initialTransforms.clear();
    this.partMaterials.clear();
    for (const key of Object.keys(this.parts)) {
      this.parts[key] = null;
    }
    this.stickLCapParts = [];
    this.stickRCapParts = [];
    this._lastInputs = null;

    if (this.renderer) {
      if (typeof this.renderer.dispose === 'function') {
        this.renderer.dispose();
      }
      if (typeof this.renderer.forceContextLoss === 'function') {
        this.renderer.forceContextLoss();
      }
      this.renderer = null;
    }

    this.scene = null;
    this.camera = null;
    this.controllerGroup = null;
    this.canvas = null;
    this.container = null;
    this.isInitialized = false;
    this.isDestroyed = true;
  }
}
