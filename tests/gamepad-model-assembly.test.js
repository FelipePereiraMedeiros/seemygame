import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createGamepadModel, GAMEPAD_MODEL_REVISION } from '../js/gamepad-model-builder.js';
import { Gamepad3DViewer } from '../js/gamepad-3d-viewer.js';

const buttonNames = ['Button_A', 'Button_B', 'Button_X', 'Button_Y', 'Button_Back', 'Button_Start', 'Button_Guide', 'Dpad_Up', 'Dpad_Down', 'Dpad_Left', 'Dpad_Right'];
let viewer;
beforeEach(() => {
  vi.spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(1); vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {});
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ createRadialGradient: () => ({ addColorStop() {} }), fillRect() {} });
});
afterEach(() => { viewer?.destroy(); viewer = null; document.body.innerHTML = ''; vi.restoreAllMocks(); });
function makeViewer() {
  const container = document.createElement('div'), canvas = document.createElement('canvas'); container.appendChild(canvas); document.body.appendChild(container);
  viewer = new Gamepad3DViewer({ container, canvas, modelUrl: null, fitToContainer: true,
    renderer: { setPixelRatio() {}, setSize() {}, render() {}, dispose() {}, forceContextLoss() {} } });
  expect(viewer.init()).toBe(true); return viewer;
}
function visibleAbove(root, name) {
  root.updateMatrixWorld(true); const part = root.getObjectByName(name), shell = root.getObjectByName('Body_Shell');
  const point = part.getWorldPosition(new THREE.Vector3()); const down = new THREE.Vector3(0, -1, 0).transformDirection(root.matrixWorld);
  const ray = new THREE.Raycaster(point.clone().addScaledVector(down, -3), down);
  const hit = ray.intersectObjects([shell, part], true)[0];
  return Boolean(hit && hit.object !== shell);
}

describe('Montagem física do controle 3D', () => {
  it('preserva a disposição da referência: analógicos simétricos abaixo do touchpad e comandos laterais', () => {
    const root = createGamepadModel(); root.updateMatrixWorld(true);
    const left = root.getObjectByName('Stick_L').position, right = root.getObjectByName('Stick_R').position;
    expect(left.x).toBeLessThan(0); expect(right.x).toBeGreaterThan(0);
    expect(left.x + right.x).toBeCloseTo(0); expect(left.z).toBeCloseTo(right.z);
    const panel = new THREE.Box3().setFromObject(root.getObjectByName('Center_Plate'));
    const size = panel.getSize(new THREE.Vector3());
    expect(size.x / size.z).toBeGreaterThan(1.6); expect(size.x / size.z).toBeLessThan(2.4);
    expect(panel.max.z).toBeLessThan(left.z - .3);
    expect(panel.min.x).toBeLessThan(left.x); expect(panel.max.x).toBeGreaterThan(right.x);
    const dpad = root.getObjectByName('Dpad_Group');
    expect(dpad.position.x).toBeLessThan(panel.min.x); expect(dpad.position.z).toBeLessThan(left.z);
    expect(dpad.children.filter(part => /^Dpad_(Up|Down|Left|Right)$/.test(part.name))).toHaveLength(4);
    expect(root.getObjectByName('Button_X').position.x).toBeGreaterThan(panel.max.x);
    expect(root.getObjectByName('Button_Y').position.z).toBeLessThan(root.getObjectByName('Button_A').position.z);
    root.traverse(part => part.geometry?.dispose());
  });
  it.each(buttonNames)('%s permanece acima da carcaça em repouso e pressionado', name => {
    makeViewer(); const root = viewer.controllerGroup.children[0];
    expect(visibleAbove(root, name)).toBe(true);
    viewer.updateInputs({ connected: true, axes: [0, 0, 0, 0], buttons: Array(17).fill(1) });
    expect(visibleAbove(root, name)).toBe(true);
  });
  it('grips acompanham as empunhaduras e não furam a face superior', () => {
    const root = createGamepadModel(); root.updateMatrixWorld(true);
    const shell = new THREE.Box3().setFromObject(root.getObjectByName('Body_Shell'));
    for (const name of ['Grip_L', 'Grip_R', 'Rear_Grip_L', 'Rear_Grip_R']) {
      const grip = root.getObjectByName(name), bounds = new THREE.Box3().setFromObject(grip);
      expect(bounds.max.y).toBeLessThan(shell.max.y);
      const axis = new THREE.Vector3(0, 1, 0).transformDirection(grip.matrixWorld);
      expect(Math.abs(axis.y)).toBeLessThan(.01);
    }
    root.traverse(part => part.geometry?.dispose());
  });
  it('separa as cabeças dos analógicos do direcional e do cluster ABXY', () => {
    const root = createGamepadModel();
    const left = root.getObjectByName('Stick_L').position, dpad = root.getObjectByName('Dpad_Group').position;
    expect(Math.hypot(left.x - dpad.x, left.z - dpad.z)).toBeGreaterThan(.34 + .40);
    const right = root.getObjectByName('Stick_R').position;
    for (const name of ['Button_A', 'Button_B', 'Button_X', 'Button_Y']) {
      const button = root.getObjectByName(name).position;
      expect(Math.hypot(right.x - button.x, right.z - button.z)).toBeGreaterThan(.34 + .13);
    }
    root.traverse(part => part.geometry?.dispose());
  });
  it('clique L3/R3 move toda a montagem uma vez, inclusive haste, e restaura sem drift', () => {
    makeViewer(); const stick = viewer.parts.stickL;
    const parts = stick.children.map(part => ({ part, local: part.position.clone() }));
    const initial = stick.position.clone();
    const clicked = Array(17).fill(0); clicked[10] = 1;
    for (let i = 0; i < 10; i++) {
      viewer.updateInputs({ connected: true, axes: [0, 0, 0, 0], buttons: clicked });
      expect(stick.position.y).toBeCloseTo(initial.y - .04);
      for (const { part, local } of parts) expect(part.position.distanceTo(local)).toBe(0);
      // Compare in model space so the camera/pivot tilt cannot hide double travel.
      for (const { part, local } of parts) expect(part.position.y + stick.position.y).toBeCloseTo(local.y + initial.y - .04);
      viewer.updateInputs({ connected: true, axes: [0, 0, 0, 0], buttons: Array(17).fill(0) });
      expect(stick.position.distanceTo(initial)).toBe(0);
    }
  });
  it('o GLB publicado mantém revisão, posições e geometria do modelo procedural', async () => {
    const bytes = fs.readFileSync('css/assets/gamepad.glb');
    // Use this test realm's ArrayBuffer; Node Buffer backing memory is another realm.
    const buffer = new ArrayBuffer(bytes.length); new Uint8Array(buffer).set(bytes);
    const gltf = await new GLTFLoader().parseAsync(buffer, '');
    const root = gltf.scene.getObjectByName('GamepadRoot'), procedural = createGamepadModel();
    expect(root.userData.modelRevision).toBe(GAMEPAD_MODEL_REVISION);
    root.updateMatrixWorld(true); procedural.updateMatrixWorld(true);
    for (const name of ['Body_Shell', 'Center_Plate', 'Grip_L', 'Grip_R', 'Stick_L', 'Stick_R', ...buttonNames]) {
      const actual = root.getObjectByName(name), expected = procedural.getObjectByName(name);
      expect(actual, name).toBeTruthy(); expect(actual.position.distanceTo(expected.position)).toBeLessThan(1e-6);
      const actualBox = new THREE.Box3().setFromObject(actual), expectedBox = new THREE.Box3().setFromObject(expected);
      expect(actualBox.min.distanceTo(expectedBox.min)).toBeLessThan(1e-5); expect(actualBox.max.distanceTo(expectedBox.max)).toBeLessThan(1e-5);
    }
    makeViewer(); viewer._disposeHierarchy(root); viewer._disposeHierarchy(procedural);
  });
});
