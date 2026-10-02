import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createGamepadModel } from ".././gamepad-model-builder.js";
/** Gamepad3DViewer: renderer. State and lifetime remain owned by the composed engine. */
export const withGamepad3DViewerRenderer = Base => class extends Base {
_setupLighting() {
    // Luz ambiente para visibilidade geral
    const ambientLight = new THREE.AmbientLight(0xe1e7f1, 1.1);
    this.scene.add(ambientLight);

    // Key Light branca direcional frontal
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.5);
    keyLight.position.set(2.5, 4.2, 3.6);
    this.scene.add(keyLight);

    // Contorno frio suave, preservando o branco da carcaça.
    const rimLight = new THREE.DirectionalLight(0xbbc8ef, .7);
    rimLight.position.set(-4.5, 2.0, -2.5);
    this.scene.add(rimLight);

    const sideFill = new THREE.DirectionalLight(0xe4efff, .8);
    sideFill.position.set(4.5, 1.8, -2.0);
    this.scene.add(sideFill);

    // Luz de preenchimento frontal suave para destacar chanfros e detalhes
    const frontFill = new THREE.PointLight(0xe2e9f8, .8, 12);
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

_fitCameraToModel() {
    if (!this.fitToContainer || !this.controllerGroup || !this.camera) return;
    this.camera.zoom = 1;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);
    this.controllerGroup.updateMatrixWorld(true);
    let extent = 0;
    // Project each part's bounds: one world-space box overestimates tilted models.
    this.controllerGroup.traverse(part => {
      if (!part.geometry || !part.visible) return;
      part.geometry.computeBoundingBox();
      const box = part.geometry.boundingBox;
      if (!box || box.isEmpty()) return;
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
        const point = new THREE.Vector3(x, y, z).applyMatrix4(part.matrixWorld).project(this.camera);
        extent = Math.max(extent, Math.abs(point.x), Math.abs(point.y));
      }
    });
    if (Number.isFinite(extent) && extent > 0) this.camera.zoom = Math.min(1, .86 / extent);
    this.camera.updateProjectionMatrix();
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
      this._fitCameraToModel();
      this.requestRender();
    }
  }

_isElementHidden() {
    if (this.isPaused) return true;
    return this._isDomHidden();
  }

requestRender() {
    if (this.isDestroyed || !this.isInitialized || !this.renderer || this._isElementHidden()) return;
    this.settleFrames = 6;
    if (!this.isRendering) {
      this.isRendering = true;
      this.animId = requestAnimationFrame(this._renderLoop);
    }
  }

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

stop() {
    this.isPaused = true;
    this.isRendering = false;
    if (this.animId !== null) {
      cancelAnimationFrame(this.animId);
      this.animId = null;
    }
  }

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
};
