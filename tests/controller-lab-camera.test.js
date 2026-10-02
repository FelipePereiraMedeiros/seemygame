import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { withGamepad3DViewerRenderer } from '../js/gamepad-3d-viewer/renderer.js';

describe('Enquadramento do modelo nos banners de controle', () => {
  it.each([.55, 1, 1.6, 3])('mantém partes rotacionadas no canvas com aspect %s', aspect => {
    const Viewer = withGamepad3DViewerRenderer(class {}); const viewer = new Viewer();
    viewer.fitToContainer = true;
    viewer.camera = new THREE.PerspectiveCamera(34, aspect, .1, 100); viewer.camera.position.set(0, 2.35, 3.35); viewer.camera.lookAt(0, -.05, .08);
    viewer.controllerGroup = new THREE.Group(); viewer.controllerGroup.rotation.set(.36, -.05, 0);
    const geometry = new THREE.BoxGeometry(4.2, .7, 2.5); const mesh = new THREE.Mesh(geometry); viewer.controllerGroup.add(mesh);
    viewer._fitCameraToModel();
    const positions = geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const point = new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld).project(viewer.camera);
      expect(Math.abs(point.x)).toBeLessThanOrEqual(.860001); expect(Math.abs(point.y)).toBeLessThanOrEqual(.860001);
    }
    geometry.dispose(); mesh.material.dispose();
  });
  it('preserva enquadramento existente quando a opção não está ativa', () => {
    const Viewer = withGamepad3DViewerRenderer(class {}); const viewer = new Viewer();
    viewer.camera = new THREE.PerspectiveCamera(); viewer.camera.zoom = .7; viewer.controllerGroup = new THREE.Group();
    viewer._fitCameraToModel(); expect(viewer.camera.zoom).toBe(.7);
  });
});
