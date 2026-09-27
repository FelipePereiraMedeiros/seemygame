/**
 * SeeMyGame - Gamepad 3D Model Builder (Ergonomic PBR Geometry)
 * Constrói a geometria tridimensional realista e anatômica do controle gamer.
 * 
 * Orientação:
 *  +X: Lado direito (ABXY, Stick R, Grip R, RB, RT)
 *  -X: Lado esquerdo (Stick L, D-Pad, Grip L, LB, LT)
 *  +Y: Face superior voltada para o jogador (Botões, analógicos, logo)
 *  -Y: Parte inferior / fundo do controle
 *  +Z: Borda inferior / empunhaduras voltadas para o usuário
 *  -Z: Borda superior / gatilhos e bumpers voltados para frente
 */

import * as THREE from 'three';

export function createGamepadModel() {
  const root = new THREE.Group();
  root.name = 'GamepadRoot';

  // ==========================================
  // 1. Materiais PBR Gamer de Alta Fidelidade
  // ==========================================

  // Carcaça principal: policarbonato grafite acetinado com toque premium
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0x2b3144,
    roughness: 0.38,
    metalness: 0.20,
    name: 'Mat_GamepadBody'
  });

  // Placa central / Touchpad: acabamento preto fosco sedoso
  const centerFaceMaterial = new THREE.MeshStandardMaterial({
    color: 0x161923,
    roughness: 0.50,
    metalness: 0.16,
    name: 'Mat_CenterFace'
  });

  // Manoplas de aderência (Rubber Grips): borracha tátil texturizada escura
  const gripMaterial = new THREE.MeshStandardMaterial({
    color: 0x12141c,
    roughness: 0.86,
    metalness: 0.05,
    name: 'Mat_Grip'
  });

  // Hastes dos analógicos e aros: metal cromado reflexivo polido
  const chromeMaterial = new THREE.MeshStandardMaterial({
    color: 0xedf1f7,
    metalness: 0.96,
    roughness: 0.08,
    name: 'Mat_Chrome'
  });

  // Poço rebaixado dos analógicos (Stick Well): acabamento interno escuro acetinado
  const stickWellMaterial = new THREE.MeshStandardMaterial({
    color: 0x10121a,
    roughness: 0.65,
    metalness: 0.28,
    name: 'Mat_StickWell'
  });

  // Cabeça dos analógicos: borracha antiderrapante
  const stickRubberMaterial = new THREE.MeshStandardMaterial({
    color: 0x1e2230,
    roughness: 0.72,
    metalness: 0.10,
    name: 'Mat_StickRubber'
  });

  // D-Pad direcional: acabamento metálico gunmetal escovado
  const dpadMaterial = new THREE.MeshStandardMaterial({
    color: 0x383e54,
    metalness: 0.72,
    roughness: 0.28,
    name: 'Mat_Dpad'
  });

  // Bumpers dos ombros (LB / RB) com material PBR individual
  const bumperLBMaterial = new THREE.MeshStandardMaterial({
    color: 0x242838,
    roughness: 0.32,
    metalness: 0.45,
    emissive: 0x000000,
    emissiveIntensity: 0.0,
    name: 'Mat_BumperLB'
  });

  const bumperRBMaterial = new THREE.MeshStandardMaterial({
    color: 0x242838,
    roughness: 0.32,
    metalness: 0.45,
    emissive: 0x000000,
    emissiveIntensity: 0.0,
    name: 'Mat_BumperRB'
  });

  // Gatilhos analógicos progressivos (LT / RT)
  const triggerLTMaterial = new THREE.MeshStandardMaterial({
    color: 0x1f2332,
    roughness: 0.35,
    metalness: 0.48,
    emissive: 0x000000,
    emissiveIntensity: 0.0,
    name: 'Mat_TriggerLT'
  });

  const triggerRTMaterial = new THREE.MeshStandardMaterial({
    color: 0x1f2332,
    roughness: 0.35,
    metalness: 0.48,
    emissive: 0x000000,
    emissiveIntensity: 0.0,
    name: 'Mat_TriggerRT'
  });

  // Botões de Ação ABXY com material brilhante e emissivo para feedback
  const btnAMaterial = new THREE.MeshStandardMaterial({
    color: 0x10b981,
    emissive: 0x059669,
    emissiveIntensity: 0.45,
    roughness: 0.16,
    metalness: 0.15,
    name: 'Mat_ButtonA'
  });

  const btnBMaterial = new THREE.MeshStandardMaterial({
    color: 0xef4444,
    emissive: 0xdc2626,
    emissiveIntensity: 0.45,
    roughness: 0.16,
    metalness: 0.15,
    name: 'Mat_ButtonB'
  });

  const btnXMaterial = new THREE.MeshStandardMaterial({
    color: 0x3b82f6,
    emissive: 0x2563eb,
    emissiveIntensity: 0.45,
    roughness: 0.16,
    metalness: 0.15,
    name: 'Mat_ButtonX'
  });

  const btnYMaterial = new THREE.MeshStandardMaterial({
    color: 0xf59e0b,
    emissive: 0xd97706,
    emissiveIntensity: 0.45,
    roughness: 0.16,
    metalness: 0.15,
    name: 'Mat_ButtonY'
  });

  // Botões do Sistema (Back, Start)
  const btnBackMaterial = new THREE.MeshStandardMaterial({
    color: 0x242838,
    roughness: 0.35,
    metalness: 0.42,
    emissive: 0x000000,
    emissiveIntensity: 0.0,
    name: 'Mat_ButtonBack'
  });

  const btnStartMaterial = new THREE.MeshStandardMaterial({
    color: 0x242838,
    roughness: 0.35,
    metalness: 0.42,
    emissive: 0x000000,
    emissiveIntensity: 0.0,
    name: 'Mat_ButtonStart'
  });

  // Botão Guide / Nexus com LED central radiante
  const guideGlowMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0x8b5cf6,
    emissiveIntensity: 0.95,
    roughness: 0.08,
    metalness: 0.20,
    name: 'Mat_GuideGlow'
  });

  const guideRingMaterial = new THREE.MeshStandardMaterial({
    color: 0x22d3ee,
    emissive: 0x06b6d4,
    emissiveIntensity: 0.80,
    roughness: 0.15,
    metalness: 0.85,
    name: 'Mat_GuideRing'
  });

  // ==========================================
  // 2. Chassi Anatômico Esculpido por Extrusão Bézier (Body)
  // ==========================================
  const bodyGroup = new THREE.Group();
  bodyGroup.name = 'Body';

  const shape = new THREE.Shape();
  // Curvas paramétricas contínuas da silhueta ergonômica
  shape.moveTo(0, 0.72);
  shape.bezierCurveTo(0.45, 0.72, 0.85, 0.68, 1.25, 0.58);
  shape.bezierCurveTo(1.65, 0.48, 1.95, 0.25, 1.98, -0.15);
  shape.bezierCurveTo(2.00, -0.55, 1.75, -1.05, 1.45, -1.35);
  shape.bezierCurveTo(1.25, -1.55, 0.95, -1.45, 0.82, -1.15);
  shape.bezierCurveTo(0.70, -0.85, 0.62, -0.45, 0.45, -0.32);
  shape.bezierCurveTo(0.25, -0.22, -0.25, -0.22, -0.45, -0.32);
  shape.bezierCurveTo(-0.62, -0.45, -0.70, -0.85, -0.82, -1.15);
  shape.bezierCurveTo(-0.95, -1.45, -1.25, -1.55, -1.45, -1.35);
  shape.bezierCurveTo(-1.75, -1.05, -2.00, -0.55, -1.98, -0.15);
  shape.bezierCurveTo(-1.95, 0.25, -1.65, 0.48, -1.25, 0.58);
  shape.bezierCurveTo(-0.85, 0.68, -0.45, 0.72, 0, 0.72);

  const extrudeSettings = {
    steps: 1,
    depth: 0.35,
    bevelEnabled: true,
    bevelThickness: 0.16,
    bevelSize: 0.14,
    bevelOffset: 0,
    bevelSegments: 8
  };

  const bodyShellGeo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
  // Alinha a extrusão para que a face do controle aponte para +Y
  bodyShellGeo.rotateX(-Math.PI / 2);
  bodyShellGeo.center();

  const bodyShellMesh = new THREE.Mesh(bodyShellGeo, bodyMaterial);
  bodyShellMesh.position.set(0, 0, 0.1);
  bodyGroup.add(bodyShellMesh);

  // Placa central / Touchpad esculpido
  const centerPlateGeo = new THREE.BoxGeometry(1.10, 0.06, 0.75);
  const centerPlate = new THREE.Mesh(centerPlateGeo, centerFaceMaterial);
  centerPlate.position.set(0, 0.22, 0.02);
  bodyGroup.add(centerPlate);

  // Barra de LED decorativa estilo Gamer / DualSense
  const ledBarGeo = new THREE.BoxGeometry(0.75, 0.03, 0.04);
  const ledBarMat = new THREE.MeshStandardMaterial({
    color: 0x06b6d4,
    emissive: 0x06b6d4,
    emissiveIntensity: 1.4
  });
  const ledBar = new THREE.Mesh(ledBarGeo, ledBarMat);
  ledBar.position.set(0, 0.26, -0.28);
  bodyGroup.add(ledBar);

  // Grip pads de borracha texturizada nas laterais das empunhaduras
  const gripPadGeo = new THREE.CapsuleGeometry(0.24, 0.85, 8, 16);
  const leftGripPad = new THREE.Mesh(gripPadGeo, gripMaterial);
  leftGripPad.position.set(-1.48, -0.02, 0.62);
  leftGripPad.rotation.set(0.35, 0.15, -0.45);
  bodyGroup.add(leftGripPad);

  const rightGripPad = new THREE.Mesh(gripPadGeo, gripMaterial);
  rightGripPad.position.set(1.48, -0.02, 0.62);
  rightGripPad.rotation.set(0.35, -0.15, 0.45);
  bodyGroup.add(rightGripPad);

  // Almofadas traseiras ergonômicas para apoio dos dedos na face inferior
  const rearGripPadGeo = new THREE.CapsuleGeometry(0.18, 0.70, 8, 16);
  const leftRearGrip = new THREE.Mesh(rearGripPadGeo, gripMaterial);
  leftRearGrip.position.set(-1.35, -0.18, 0.55);
  leftRearGrip.rotation.set(0.25, 0.10, -0.40);
  bodyGroup.add(leftRearGrip);

  const rightRearGrip = new THREE.Mesh(rearGripPadGeo, gripMaterial);
  rightRearGrip.position.set(1.35, -0.18, 0.55);
  rightRearGrip.rotation.set(0.25, -0.10, 0.40);
  bodyGroup.add(rightRearGrip);

  // Poço rebaixado e anel para o Analógico Esquerdo
  const wellCavityGeo = new THREE.CylinderGeometry(0.38, 0.34, 0.08, 32);
  const leftWellCavity = new THREE.Mesh(wellCavityGeo, stickWellMaterial);
  leftWellCavity.position.set(-0.80, 0.19, -0.12);
  bodyGroup.add(leftWellCavity);

  const socketGeo = new THREE.TorusGeometry(0.395, 0.038, 16, 32);
  const leftSocket = new THREE.Mesh(socketGeo, centerFaceMaterial);
  leftSocket.rotation.x = Math.PI / 2;
  leftSocket.position.set(-0.80, 0.22, -0.12);
  bodyGroup.add(leftSocket);

  const trimRingGeo = new THREE.TorusGeometry(0.382, 0.014, 12, 32);
  const leftTrimRing = new THREE.Mesh(trimRingGeo, chromeMaterial);
  leftTrimRing.rotation.x = Math.PI / 2;
  leftTrimRing.position.set(-0.80, 0.22, -0.12);
  bodyGroup.add(leftTrimRing);

  // Poço rebaixado e anel para o Analógico Direito
  const rightWellCavity = new THREE.Mesh(wellCavityGeo, stickWellMaterial);
  rightWellCavity.position.set(0.65, 0.19, 0.35);
  bodyGroup.add(rightWellCavity);

  const rightSocket = new THREE.Mesh(socketGeo, centerFaceMaterial);
  rightSocket.rotation.x = Math.PI / 2;
  rightSocket.position.set(0.65, 0.22, 0.35);
  bodyGroup.add(rightSocket);

  const rightTrimRing = new THREE.Mesh(trimRingGeo, chromeMaterial);
  rightTrimRing.rotation.x = Math.PI / 2;
  rightTrimRing.position.set(0.65, 0.22, 0.35);
  bodyGroup.add(rightTrimRing);

  root.add(bodyGroup);

  // ==========================================
  // Função auxiliar para construir Analógicos Ergonômicos
  // ==========================================
  const buildAnalogStick = (name, x, z) => {
    const stick = new THREE.Group();
    stick.name = name;
    stick.position.set(x, 0.22, z);

    // Gimbal esférico interno
    const stickSphere = new THREE.SphereGeometry(0.30, 20, 16);
    const stickBall = new THREE.Mesh(stickSphere, gripMaterial);
    stickBall.name = `${name}_Ball`;
    stick.add(stickBall);

    // Haste cromada polida
    const stickStemGeo = new THREE.CylinderGeometry(0.065, 0.075, 0.25, 16);
    const stickStem = new THREE.Mesh(stickStemGeo, chromeMaterial);
    stickStem.name = `${name}_Stem`;
    stickStem.position.y = 0.19;
    stick.add(stickStem);

    // Corpo da cabeça do analógico em borracha
    const stickCapGeo = new THREE.CylinderGeometry(0.34, 0.30, 0.11, 28);
    const stickCap = new THREE.Mesh(stickCapGeo, stickRubberMaterial);
    stickCap.name = `${name}_Cap`;
    stickCap.position.y = 0.31;
    stick.add(stickCap);

    // Rebaixo côncavo ergonômico no centro da cúpula para o polegar
    const thumbDishGeo = new THREE.CylinderGeometry(0.24, 0.20, 0.025, 24);
    const thumbDish = new THREE.Mesh(thumbDishGeo, centerFaceMaterial);
    thumbDish.name = `${name}_Dish`;
    thumbDish.position.y = 0.355;
    stick.add(thumbDish);

    // Anel texturizado antiderrapante no topo do analógico
    const stickRimGeo = new THREE.TorusGeometry(0.26, 0.028, 12, 32);
    const stickRim = new THREE.Mesh(stickRimGeo, stickRubberMaterial);
    stickRim.name = `${name}_Rim`;
    stickRim.rotation.x = Math.PI / 2;
    stickRim.position.y = 0.365;
    stick.add(stickRim);

    // Ranhuras antiderrapantes nos 4 pontos cardeais da borda
    const grooveGeo = new THREE.BoxGeometry(0.04, 0.02, 0.07);
    const angles = [0, Math.PI / 2, Math.PI, (Math.PI * 3) / 2];
    for (let i = 0; i < angles.length; i++) {
      const angle = angles[i];
      const groove = new THREE.Mesh(grooveGeo, bodyMaterial);
      groove.name = `${name}_Groove_${i}`;
      groove.position.set(Math.sin(angle) * 0.26, 0.37, Math.cos(angle) * 0.26);
      groove.rotation.y = angle;
      stick.add(groove);
    }

    return stick;
  };

  // 3. Analógico Esquerdo (Stick_L) - Superior Esquerdo
  const stickL = buildAnalogStick('Stick_L', -0.80, -0.12);
  root.add(stickL);

  // 4. Analógico Direito (Stick_R) - Inferior Direito
  const stickR = buildAnalogStick('Stick_R', 0.65, 0.35);
  root.add(stickR);

  // ==========================================
  // 5. D-Pad Direcional (Cruz) - Inferior Esquerdo
  // ==========================================
  const dpadGroup = new THREE.Group();
  dpadGroup.name = 'Dpad_Group';
  dpadGroup.position.set(-0.65, 0.23, 0.35);

  // Base circular rebaixada
  const dpadBase = new THREE.Mesh(new THREE.CylinderGeometry(0.40, 0.44, 0.08, 32), centerFaceMaterial);
  dpadBase.name = 'Dpad_Base';
  dpadGroup.add(dpadBase);

  // Braços da cruz com entalhes direcionais e materiais PBR gunmetal
  const dpadUp = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.11, 0.28), dpadMaterial);
  dpadUp.name = 'Dpad_Up';
  dpadUp.position.set(0, 0.06, -0.15);
  dpadGroup.add(dpadUp);

  const dpadDown = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.11, 0.28), dpadMaterial);
  dpadDown.name = 'Dpad_Down';
  dpadDown.position.set(0, 0.06, 0.15);
  dpadGroup.add(dpadDown);

  const dpadLeft = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.11, 0.18), dpadMaterial);
  dpadLeft.name = 'Dpad_Left';
  dpadLeft.position.set(-0.15, 0.06, 0);
  dpadGroup.add(dpadLeft);

  const dpadRight = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.11, 0.18), dpadMaterial);
  dpadRight.name = 'Dpad_Right';
  dpadRight.position.set(0.15, 0.06, 0);
  dpadGroup.add(dpadRight);

  const dpadCenter = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.13, 16), dpadMaterial);
  dpadCenter.name = 'Dpad_Center';
  dpadCenter.position.y = 0.06;
  dpadGroup.add(dpadCenter);

  root.add(dpadGroup);

  // ==========================================
  // 6. Botões de Ação ABXY - Superior Direito
  // Padrão clássico em losango:
  //      (Y) [-Z]
  //  (X)     (B)
  //      (A) [+Z]
  // ==========================================
  const createButton = (name, mat, x, y, z) => {
    const btn = new THREE.Group();
    btn.name = name;
    btn.position.set(x, y, z);

    // Base cilíndrica com borda chanfrada
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.09, 24), mat);
    base.position.y = 0.05;
    btn.add(base);

    // Cúpula arredondada brilhante
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.125, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat);
    dome.position.y = 0.085;
    btn.add(dome);

    return btn;
  };

  const btnCenterX = 0.88;
  const btnCenterZ = -0.12;
  const btnDist = 0.23;

  const btnA = createButton('Button_A', btnAMaterial, btnCenterX, 0.22, btnCenterZ + btnDist);
  const btnB = createButton('Button_B', btnBMaterial, btnCenterX + btnDist, 0.22, btnCenterZ);
  const btnX = createButton('Button_X', btnXMaterial, btnCenterX - btnDist, 0.22, btnCenterZ);
  const btnY = createButton('Button_Y', btnYMaterial, btnCenterX, 0.22, btnCenterZ - btnDist);

  root.add(btnA);
  root.add(btnB);
  root.add(btnX);
  root.add(btnY);

  // ==========================================
  // 7. Botões do Sistema (Back, Start, Guide)
  // ==========================================
  const btnBack = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.06, 16), btnBackMaterial);
  btnBack.name = 'Button_Back';
  btnBack.position.set(-0.28, 0.24, -0.04);
  root.add(btnBack);

  const btnStart = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.06, 16), btnStartMaterial);
  btnStart.name = 'Button_Start';
  btnStart.position.set(0.28, 0.24, -0.04);
  root.add(btnStart);

  const btnGuide = new THREE.Group();
  btnGuide.name = 'Button_Guide';
  btnGuide.position.set(0, 0.24, -0.02);

  const guideDisc = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.07, 32), guideGlowMaterial);
  guideDisc.name = 'Button_Guide_Disc';
  guideDisc.position.y = 0.04;
  btnGuide.add(guideDisc);

  const guideRing = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.022, 12, 32), guideRingMaterial);
  guideRing.name = 'Button_Guide_Ring';
  guideRing.rotation.x = Math.PI / 2;
  guideRing.position.y = 0.05;
  btnGuide.add(guideRing);

  root.add(btnGuide);

  // ==========================================
  // 8. Bumpers dos Ombros (LB / RB) - Borda Superior (-Z)
  // ==========================================
  const bumperGeo = new THREE.BoxGeometry(0.70, 0.17, 0.30);
  const bumperLB = new THREE.Mesh(bumperGeo, bumperLBMaterial);
  bumperLB.name = 'Bumper_LB';
  bumperLB.position.set(-0.85, 0.16, -0.68);
  bumperLB.rotation.set(-0.22, 0.08, 0.10);
  root.add(bumperLB);

  const bumperRB = new THREE.Mesh(bumperGeo, bumperRBMaterial);
  bumperRB.name = 'Bumper_RB';
  bumperRB.position.set(0.85, 0.16, -0.68);
  bumperRB.rotation.set(-0.22, -0.08, -0.10);
  root.add(bumperRB);

  // ==========================================
  // 9. Gatilhos Analógicos (Trigger_LT / Trigger_RT)
  // ==========================================
  const createTrigger = (name, mat, x) => {
    const triggerGroup = new THREE.Group();
    triggerGroup.name = name;
    // O ponto de rotação (pivô da dobradiça) fica no topo superior
    triggerGroup.position.set(x, 0.14, -0.88);

    const bladeGeo = new THREE.BoxGeometry(0.42, 0.32, 0.26);
    const blade = new THREE.Mesh(bladeGeo, mat);
    blade.name = `${name}_Blade`;
    blade.position.set(0, -0.12, -0.06);
    blade.rotation.x = -0.28;
    triggerGroup.add(blade);

    return triggerGroup;
  };

  const triggerLT = createTrigger('Trigger_LT', triggerLTMaterial, -0.88);
  const triggerRT = createTrigger('Trigger_RT', triggerRTMaterial, 0.88);
  root.add(triggerLT);
  root.add(triggerRT);

  return root;
}
