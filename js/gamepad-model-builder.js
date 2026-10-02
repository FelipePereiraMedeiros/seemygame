/** Symmetric controller: +Y face, -Z shoulders, +Z handle tips.
 * Named pivots are shared by the procedural model and the exported GLB.
 */
import * as THREE from 'three';
export const GAMEPAD_MODEL_REVISION = 'symmetric-3';
const material = (name, color, roughness, metalness = .04, emissive = 0, emissiveIntensity = 0) =>
  new THREE.MeshStandardMaterial({ name, color, roughness, metalness, emissive, emissiveIntensity });
function outline(draw) {
  const shape = new THREE.Shape();
  draw({ move: (x, z) => shape.moveTo(x, -z), line: (x, z) => shape.lineTo(x, -z),
    curve: (a, b, c, d, x, z) => shape.bezierCurveTo(a, -b, c, -d, x, -z) });
  shape.closePath(); return shape;
}
function roundedFace(shape, depth, bevel = .025, curveSegments = 10) {
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, steps: 1, curveSegments,
    bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 4 });
  geometry.rotateX(-Math.PI / 2); geometry.translate(0, -depth / 2, 0); return geometry;
}
function mesh(parent, name, geometry, mat, x = 0, y = 0, z = 0) {
  const part = new THREE.Mesh(geometry, mat); part.name = name; part.position.set(x, y, z); parent.add(part); return part;
}
function ring(parent, name, radius, tube, mat, x, y, z) {
  const part = mesh(parent, name, new THREE.TorusGeometry(radius, tube, 12, 48), mat, x, y, z);
  part.rotation.x = Math.PI / 2; return part;
}
function stroke(parent, name, points, mat, radius = .009) {
  const path = new THREE.CurvePath();
  for (let i = 1; i < points.length; i++) {
    path.add(new THREE.LineCurve3(new THREE.Vector3(...points[i - 1]), new THREE.Vector3(...points[i])));
  }
  return mesh(parent, name, new THREE.TubeGeometry(path, (points.length - 1) * 4, radius, 6, false), mat);
}
export function createGamepadModel() {
  const root = new THREE.Group(); root.name = 'GamepadRoot'; root.userData.modelRevision = GAMEPAD_MODEL_REVISION;
  const white = material('Mat_GamepadBody', 0xe6e8ed, .48, .03);
  const touchpad = material('Mat_Touchpad', 0xd2d5dc, .58, .02);
  const inset = material('Mat_CenterFace', 0x242831, .58, .05);
  const rubber = material('Mat_Grip', 0x181b22, .90);
  const chrome = material('Mat_Chrome', 0x7a8597, .25, .96);
  const well = material('Mat_StickWell', 0x11151c, .76);
  const cap = material('Mat_StickRubber', 0x272b34, .80);
  const dpadMat = material('Mat_Dpad', 0x414753, .48, .12);
  const glyph = material('Mat_ButtonGlyph', 0x6c7b94, .48, .05);
  const body = new THREE.Group(); body.name = 'Body'; root.add(body);
  const shellShape = outline(({ move, curve }) => {
    move(0, -.97);
    curve(.50, -.97, .93, -.98, 1.27, -.91);
    curve(1.62, -1.07, 1.93, -.94, 2.02, -.52);
    curve(2.20, .12, 2.23, .98, 2.06, 1.59);
    curve(1.97, 1.93, 1.67, 1.98, 1.49, 1.68);
    curve(1.29, 1.35, 1.19, .98, .98, .88);
    curve(.77, .77, .30, .81, 0, .81);
    curve(-.30, .81, -.77, .77, -.98, .88);
    curve(-1.19, .98, -1.29, 1.35, -1.49, 1.68);
    curve(-1.67, 1.98, -1.97, 1.93, -2.06, 1.59);
    curve(-2.23, .98, -2.20, .12, -2.02, -.52);
    curve(-1.93, -.94, -1.62, -1.07, -1.27, -.91);
    curve(-.93, -.98, -.50, -.97, 0, -.97);
  });
  const shellGeo = roundedFace(shellShape, .27, .075);
  const vertices = shellGeo.attributes.position;
  for (let i = 0; i < vertices.count; i++) {
    const x = vertices.getX(i), z = vertices.getZ(i);
    vertices.setY(i, vertices.getY(i) + .017 * Math.max(0, 1 - (x * x + .3 * z * z) / 5));
  }
  shellGeo.computeVertexNormals(); mesh(body, 'Body_Shell', shellGeo, white);
  const lower = mesh(body, 'Body_LowerShell', roundedFace(shellShape, .22, .065), rubber, 0, -.15);
  lower.scale.set(.985, 1, .985);
  const insertShape = outline(({ move, curve, line }) => {
    move(-.94, -.91); line(.94, -.91);
    curve(1.08, -.88, 1.00, -.40, 1.12, -.06);
    curve(1.29, .29, 1.32, .71, 1.08, .87);
    curve(.80, .75, .24, .73, 0, .74);
    curve(-.24, .73, -.80, .75, -1.08, .87);
    curve(-1.32, .71, -1.29, .29, -1.12, -.06);
    curve(-1.00, -.40, -1.08, -.88, -.94, -.91);
  });
  mesh(body, 'Center_Insert', roundedFace(insertShape, .035, .018), inset, 0, .22);
  const panelShape = outline(({ move, curve, line }) => {
    move(-.78, -.91); line(.78, -.91);
    curve(.94, -.91, 1.00, -.84, .97, -.66);
    line(.87, -.12); curve(.85, .01, .77, .055, .63, .055);
    line(-.63, .055); curve(-.77, .055, -.85, .01, -.87, -.12);
    line(-.97, -.66); curve(-1.00, -.84, -.94, -.91, -.78, -.91);
  });
  mesh(body, 'Center_Plate', roundedFace(panelShape, .035, .035), touchpad, 0, .26);
  const led = material('Mat_StatusLight', 0x719dd7, .42, .05, 0x4076b5, .25);
  mesh(body, 'Status_Light', new THREE.BoxGeometry(1.18, .014, .022), led, 0, .264, .105);
  for (let row = 0; row < 2; row++) for (let column = 0; column < 5 - row; column++) {
    mesh(body, `Speaker_${row}_${column}`, new THREE.CylinderGeometry(.018, .018, .008, 12), well,
      (column - (4 - row) / 2) * .075, .258, .22 + row * .055);
  }
  mesh(body, 'Mute_Button', new THREE.BoxGeometry(.18, .025, .043), inset, 0, .225, .68);
  for (const [side, sign] of [['L', -1], ['R', 1]]) {
    const pad = mesh(body, `Grip_${side}`, new THREE.CapsuleGeometry(.19, .79, 8, 16), rubber, sign * 1.76, -.15, 1.05);
    pad.rotation.set(Math.PI / 2, 0, -sign * .24);
    const rear = mesh(body, `Rear_Grip_${side}`, new THREE.CapsuleGeometry(.15, .66, 8, 16), rubber, sign * 1.64, -.25, 1.09);
    rear.rotation.set(Math.PI / 2, 0, -sign * .28);
  }
  const stickX = .72, stickZ = .47;
  for (const [side, sign] of [['L', -1], ['R', 1]]) {
    const x = sign * stickX;
    mesh(body, `Stick_${side}_Well`, new THREE.CylinderGeometry(.40, .36, .06, 48), well, x, .242, stickZ);
    ring(body, `Stick_${side}_Socket`, .397, .025, inset, x, .264, stickZ);
    ring(body, `Stick_${side}_Trim`, .374, .010, chrome, x, .268, stickZ);
    const name = `Stick_${side}`, stick = new THREE.Group(); stick.name = name; stick.position.set(x, .255, stickZ); root.add(stick);
    mesh(stick, `${name}_Ball`, new THREE.SphereGeometry(.245, 24, 16), rubber);
    mesh(stick, `${name}_Stem`, new THREE.CylinderGeometry(.055, .07, .16, 16), chrome, 0, .13);
    mesh(stick, `${name}_Cap`, new THREE.CylinderGeometry(.32, .29, .09, 48), cap, 0, .245);
    mesh(stick, `${name}_Dish`, new THREE.CylinderGeometry(.245, .22, .025, 40), inset, 0, .275);
    ring(stick, `${name}_Rim`, .268, .021, cap, 0, .289, 0);
    for (let i = 0; i < 12; i++) {
      const angle = i * Math.PI / 6;
      const groove = mesh(stick, `${name}_Groove_${i}`, new THREE.BoxGeometry(.014, .011, .035), rubber,
        Math.sin(angle) * .287, .29, Math.cos(angle) * .287);
      groove.rotation.y = angle;
    }
  }
  const dpad = new THREE.Group(); dpad.name = 'Dpad_Group'; dpad.position.set(-1.43, .25, -.30); root.add(dpad);
  const base = mesh(dpad, 'Dpad_Base', new THREE.BoxGeometry(.44, .025, .44), inset, 0, .009); base.rotation.y = Math.PI / 4;
  const keyShape = outline(({ move, curve, line }) => {
    move(-.08, -.15); line(.08, -.15); curve(.12, -.15, .14, -.12, .14, -.075);
    line(.14, .05); curve(.14, .09, .04, .16, 0, .17); curve(-.04, .16, -.14, .09, -.14, .05);
    line(-.14, -.075); curve(-.14, -.12, -.12, -.15, -.08, -.15);
  });
  const keyGeo = roundedFace(keyShape, .065, .02, 6);
  for (const [name, x, z, angle] of [['Up', 0, -.235, 0], ['Down', 0, .235, Math.PI], ['Left', -.235, 0, Math.PI / 2], ['Right', .235, 0, -Math.PI / 2]]) {
    const key = mesh(dpad, `Dpad_${name}`, keyGeo, dpadMat, x, .075, z); key.rotation.y = angle;
  }
  mesh(dpad, 'Dpad_Center', new THREE.CylinderGeometry(.067, .067, .025, 16), inset, 0, .014);
  const centerX = 1.48, centerZ = -.30, spacing = .32;
  for (const [letter, symbol, x, z] of [['A', 'cross', centerX, centerZ + spacing], ['B', 'circle', centerX + spacing, centerZ], ['X', 'square', centerX - spacing, centerZ], ['Y', 'triangle', centerX, centerZ - spacing]]) {
    const btn = new THREE.Group(); btn.name = `Button_${letter}`; btn.position.set(x, .27, z); root.add(btn);
    const buttonMat = material(`Mat_Button${letter}`, 0xb9c2d1, .32, .04, 0x435c83, .05);
    mesh(btn, `${btn.name}_Rim`, new THREE.CylinderGeometry(.175, .178, .05, 40), inset, 0, .015);
    mesh(btn, `${btn.name}_Cap`, new THREE.CylinderGeometry(.155, .164, .075, 40), buttonMat, 0, .056);
    const h = .099, r = .083;
    if (symbol === 'circle') ring(btn, 'Glyph_Circle', r, .008, glyph, 0, h, 0);
    if (symbol === 'cross') {
      stroke(btn, 'Glyph_Cross_1', [[-r, h, -r], [r, h, r]], glyph);
      stroke(btn, 'Glyph_Cross_2', [[-r, h, r], [r, h, -r]], glyph);
    }
    if (symbol === 'square') stroke(btn, 'Glyph_Square', [[-r,h,-r],[r,h,-r],[r,h,r],[-r,h,r],[-r,h,-r]], glyph);
    if (symbol === 'triangle') stroke(btn, 'Glyph_Triangle', [[0,h,-r],[r,h,r],[-r,h,r],[0,h,-r]], glyph);
  }
  for (const [name, sign] of [['Back', -1], ['Start', 1]]) {
    const mat = material(`Mat_Button${name}`, 0x676f7b, .46, .05);
    const key = mesh(root, `Button_${name}`, new THREE.CapsuleGeometry(.038, .115, 8, 16), mat, sign * 1.10, .31, -.67);
    key.rotation.x = Math.PI / 2;
  }
  const guide = new THREE.Group(); guide.name = 'Button_Guide'; guide.position.set(0, .29, .47); root.add(guide);
  const guideMat = material('Mat_GuideGlow', 0x4d5b70, .48, .05, 0x365b8b, .6);
  const guideRingMat = material('Mat_GuideRing', 0x45658a, .46, .05, 0x24405f, .20);
  mesh(guide, 'Button_Guide_Disc', new THREE.CylinderGeometry(.105, .115, .055, 32), guideMat, 0, .036);
  ring(guide, 'Button_Guide_Ring', .116, .012, guideRingMat, 0, .056, 0);
  for (const [side, sign] of [['L', -1], ['R', 1]]) {
    const bumperMat = material(`Mat_Bumper${side === 'L' ? 'LB' : 'RB'}`, 0x303640, .42, .12);
    const shoulder = mesh(root, `Bumper_${side === 'L' ? 'LB' : 'RB'}`, new THREE.CapsuleGeometry(.09, .52, 8, 24), bumperMat, sign * 1.42, .13, -1.015);
    shoulder.rotation.set(0, 0, Math.PI / 2);
    const trigger = new THREE.Group(); trigger.name = `Trigger_${side === 'L' ? 'LT' : 'RT'}`;
    trigger.position.set(sign * 1.46, -.045, -1.05); root.add(trigger);
    const triggerMat = material(`Mat_${trigger.name}`, 0x292e38, .43, .16);
    const blade = mesh(trigger, `${trigger.name}_Blade`, new THREE.BoxGeometry(.43, .22, .24), triggerMat, 0, -.10, -.04);
    blade.rotation.x = -.20;
  }
  return root;
}
