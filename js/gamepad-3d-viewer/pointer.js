import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createGamepadModel } from ".././gamepad-model-builder.js";
/** Gamepad3DViewer: pointer. State and lifetime remain owned by the composed engine. */
export const withGamepad3DViewerPointer = Base => class extends Base {
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
};
