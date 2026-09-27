import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { createGamepadModel } from '../js/gamepad-model-builder.js';
import { Gamepad3DViewer } from '../js/gamepad-3d-viewer.js';

// Polyfill básico para canvas 2d no JSDOM para silenciar avisos
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = function (type) {
    if (type === '2d') {
      return {
        createRadialGradient: () => ({ addColorStop: vi.fn() }),
        fillRect: vi.fn(),
        clearRect: vi.fn(),
        drawImage: vi.fn(),
        getImageData: vi.fn(() => ({ data: [] }))
      };
    }
    return null;
  };
}

function createMockRenderer(canvas) {
  const c = canvas || document.createElement('canvas');
  return {
    domElement: c,
    setPixelRatio: vi.fn(),
    setSize: vi.fn(),
    render: vi.fn(),
    dispose: vi.fn(),
    forceContextLoss: vi.fn(),
    outputColorSpace: null,
    toneMapping: null,
    toneMappingExposure: 1.0
  };
}

describe('R1. Ergonomic 3D Gamepad Geometry & PBR Materials', () => {
  it('gera modelo GamepadRoot com todos os 15 nós nomeados obrigatórios', () => {
    const root = createGamepadModel();
    expect(root).toBeInstanceOf(THREE.Group);
    expect(root.name).toBe('GamepadRoot');

    const requiredNodes = [
      'Stick_L',
      'Stick_R',
      'Dpad_Group',
      'Button_A',
      'Button_B',
      'Button_X',
      'Button_Y',
      'Bumper_LB',
      'Bumper_RB',
      'Trigger_LT',
      'Trigger_RT',
      'Button_Back',
      'Button_Start',
      'Button_Guide',
      'Body'
    ];

    for (const nodeName of requiredNodes) {
      const node = root.getObjectByName(nodeName);
      expect(node, `Nó obrigatório ${nodeName} não encontrado`).toBeTruthy();
    }
  });

  it('possui poços de analógico rebaixados e anéis de acabamento dentro de Body', () => {
    const root = createGamepadModel();
    const body = root.getObjectByName('Body');
    expect(body).toBeTruthy();

    let foundStickWellMaterial = false;
    let foundChromeTrim = false;
    let foundCenterFaceSocket = false;

    body.traverse((child) => {
      if (child.isMesh && child.material) {
        const mat = child.material;
        if (mat.name === 'Mat_StickWell') foundStickWellMaterial = true;
        if (mat.name === 'Mat_Chrome') foundChromeTrim = true;
        if (mat.name === 'Mat_CenterFace') foundCenterFaceSocket = true;
      }
    });

    expect(foundStickWellMaterial, 'Material Mat_StickWell para poços rebaixados ausente').toBe(true);
    expect(foundChromeTrim, 'Anel cromado de acabamento do poço ausente').toBe(true);
    expect(foundCenterFaceSocket, 'Soquete externo do analógico ausente').toBe(true);
  });

  it('constrói analógicos com haste cromada, cúpula côncava e ranhuras antiderrapantes', () => {
    const root = createGamepadModel();

    for (const stickName of ['Stick_L', 'Stick_R']) {
      const stick = root.getObjectByName(stickName);
      expect(stick).toBeTruthy();

      const ball = stick.getObjectByName(`${stickName}_Ball`);
      const stem = stick.getObjectByName(`${stickName}_Stem`);
      const cap = stick.getObjectByName(`${stickName}_Cap`);

      expect(ball).toBeTruthy();
      expect(stem).toBeTruthy();
      expect(cap).toBeTruthy();

      expect(stem.material.name).toBe('Mat_Chrome');
      expect(stem.material.metalness).toBeGreaterThanOrEqual(0.9);

      expect(cap.material.name).toBe('Mat_StickRubber');
      expect(cap.material.roughness).toBeGreaterThanOrEqual(0.6);

      // Deve ter ao menos 6 filhos (Ball, Stem, Cap, Dish, Rim, Grooves...)
      expect(stick.children.length).toBeGreaterThanOrEqual(6);
    }
  });

  it('possui materiais PBR gamer configurados com fidelidade tátil', () => {
    const root = createGamepadModel();
    const materialsByName = new Map();

    root.traverse((child) => {
      if (child.isMesh && child.material) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        for (const m of mats) {
          if (m.name) materialsByName.set(m.name, m);
        }
      }
    });

    // Carcaça principal
    const matBody = materialsByName.get('Mat_GamepadBody');
    expect(matBody).toBeDefined();
    expect(matBody.roughness).toBeCloseTo(0.38, 1);
    expect(matBody.metalness).toBeCloseTo(0.20, 1);

    // Borracha de grip
    const matGrip = materialsByName.get('Mat_Grip');
    expect(matGrip).toBeDefined();
    expect(matGrip.roughness).toBeGreaterThanOrEqual(0.8);

    // Metal Gunmetal D-Pad
    const matDpad = materialsByName.get('Mat_Dpad');
    expect(matDpad).toBeDefined();
    expect(matDpad.metalness).toBeGreaterThanOrEqual(0.65);

    // Botões ABXY com emissivo base
    for (const btnLetter of ['A', 'B', 'X', 'Y']) {
      const matBtn = materialsByName.get(`Mat_Button${btnLetter}`);
      expect(matBtn).toBeDefined();
      expect(matBtn.emissiveIntensity).toBeGreaterThan(0);
    }
  });

  it('valida que os arquivos GLB gerados existem sob css/assets e dist/css/assets com cabeçalho válido', () => {
    const files = [
      path.resolve('css', 'assets', 'gamepad.glb'),
      path.resolve('dist', 'css', 'assets', 'gamepad.glb')
    ];

    for (const filePath of files) {
      expect(fs.existsSync(filePath), `Arquivo ${filePath} deve existir`).toBe(true);
      const stat = fs.statSync(filePath);
      expect(stat.size).toBeGreaterThan(100 * 1024); // > 100KB

      // Checa os primeiros 4 bytes do cabeçalho binário glTF (0x46546C67 = 'glTF')
      const buffer = fs.readFileSync(filePath);
      const magic = buffer.toString('utf8', 0, 4);
      expect(magic).toBe('glTF');
    }
  });
});

describe('R2. Reactive Input Feedback & Visual Interactivity', () => {
  let container;
  let canvas;
  let mockRenderer;
  let viewer;

  beforeEach(() => {
    container = document.createElement('div');
    canvas = document.createElement('canvas');
    container.appendChild(canvas);
    document.body.appendChild(container);

    mockRenderer = createMockRenderer(canvas);
    viewer = new Gamepad3DViewer({
      container,
      canvas,
      renderer: mockRenderer,
      enableMouseTracking: true
    });
    viewer.init();
  });

  afterEach(() => {
    if (viewer) {
      viewer.destroy();
    }
    if (container && container.parentElement) {
      container.parentElement.removeChild(container);
    }
  });

  it('deflete analógicos respeitando limites físicos esféricos e deprime o stick no clique L3/R3', () => {
    const stickL = viewer.parts.stickL;
    const stickR = viewer.parts.stickR;
    const initL = viewer.initialTransforms.get(stickL);
    const initR = viewer.initialTransforms.get(stickR);

    // Deflexão simples nos eixos
    viewer.updateInputs({
      axes: [0.75, -0.5, -0.6, 0.8],
      buttons: []
    });

    expect(stickL.rotation.z).not.toBe(initL.rot.z);
    expect(stickL.rotation.x).not.toBe(initL.rot.x);
    expect(stickR.rotation.z).not.toBe(initR.rot.z);
    expect(stickR.rotation.x).not.toBe(initR.rot.x);

    // Limite físico circular: vetor [1.0, 1.0] cuja magnitude é sqrt(2) ~ 1.414 deve ser limitado a 1.0
    viewer.updateInputs({
      axes: [1.0, 1.0, 0, 0],
      buttons: []
    });

    const angleX = Math.abs(stickL.rotation.x - initL.rot.x);
    const angleZ = Math.abs(stickL.rotation.z - initL.rot.z);
    const combinedAngle = Math.hypot(angleX, angleZ);
    // Deve respeitar o MAX_STICK_ANGLE de ~0.42 radianos
    expect(combinedAngle).toBeLessThanOrEqual(0.43);

    // Stick click (L3 = botão 10, R3 = botão 11)
    viewer.updateInputs({
      axes: [0, 0, 0, 0],
      buttons: [
        ...Array(10).fill({ pressed: false, value: 0 }),
        { pressed: true, value: 1.0 }, // 10: L3
        { pressed: true, value: 1.0 }  // 11: R3
      ]
    });

    expect(stickL.position.y).toBeLessThan(initL.pos.y);
    expect(stickR.position.y).toBeLessThan(initR.pos.y);
  });

  it('rotaciona os gatilhos analógicos LT e RT progressivamente e modula emissivo de profundidade', () => {
    const triggerLT = viewer.parts.triggerLT;
    const triggerRT = viewer.parts.triggerRT;
    const initLT = viewer.initialTransforms.get(triggerLT);
    const initRT = viewer.initialTransforms.get(triggerRT);

    // Estado inicial de repouso
    viewer.updateInputs({ axes: [0, 0, 0, 0], buttons: [] });
    expect(triggerLT.rotation.x).toBeCloseTo(initLT.rot.x, 3);
    expect(triggerRT.rotation.x).toBeCloseTo(initRT.rot.x, 3);

    // LT pressionado a 50%, RT a 100%
    const buttons = Array(8).fill({ pressed: false, value: 0 });
    buttons[6] = { pressed: true, value: 0.5 }; // LT
    buttons[7] = { pressed: true, value: 1.0 }; // RT

    viewer.updateInputs({ axes: [0, 0, 0, 0], buttons });

    expect(triggerLT.rotation.x).toBeLessThan(initLT.rot.x);
    expect(triggerRT.rotation.x).toBeLessThan(initLT.rot.x);
    // RT (100%) deve ter deflexão angular maior que LT (50%)
    expect(Math.abs(triggerRT.rotation.x - initRT.rot.x)).toBeGreaterThan(
      Math.abs(triggerLT.rotation.x - initLT.rot.x)
    );

    // Verifica material emissivo proporcional do gatilho
    const ltRecords = viewer.partMaterials.get(triggerLT);
    expect(ltRecords).toBeDefined();
    expect(ltRecords[0].material.emissiveIntensity).toBeGreaterThan(0.5);
  });

  it('deprime botões de ação ABXY e modula brilho emissivo responsivo', () => {
    const btnA = viewer.parts.buttonA;
    const initA = viewer.initialTransforms.get(btnA);
    const recordsA = viewer.partMaterials.get(btnA);
    const baseIntensity = recordsA[0].baseIntensity;

    // Botão A pressionado (índice 0)
    viewer.updateInputs({
      buttons: [{ pressed: true, value: 1.0 }]
    });

    expect(btnA.position.y).toBeLessThan(initA.pos.y);
    expect(recordsA[0].material.emissiveIntensity).toBeGreaterThan(baseIntensity * 2);

    // Botão A liberado
    viewer.updateInputs({
      buttons: [{ pressed: false, value: 0.0 }]
    });

    expect(btnA.position.y).toBeCloseTo(initA.pos.y, 3);
    expect(recordsA[0].material.emissiveIntensity).toBeCloseTo(baseIntensity, 3);
  });

  it('deprime bumpers dos ombros (LB / RB) e botões de sistema com acentos de brilho', () => {
    const bumperLB = viewer.parts.bumperLB;
    const bumperRB = viewer.parts.bumperRB;
    const btnBack = viewer.parts.buttonBack;
    const btnStart = viewer.parts.buttonStart;

    const initLB = viewer.initialTransforms.get(bumperLB);
    const initRB = viewer.initialTransforms.get(bumperRB);
    const initBack = viewer.initialTransforms.get(btnBack);
    const initStart = viewer.initialTransforms.get(btnStart);

    const buttons = Array(17).fill({ pressed: false, value: 0 });
    buttons[4] = { pressed: true, value: 1.0 }; // LB
    buttons[5] = { pressed: true, value: 1.0 }; // RB
    buttons[8] = { pressed: true, value: 1.0 }; // Back
    buttons[9] = { pressed: true, value: 1.0 }; // Start

    viewer.updateInputs({ buttons });

    expect(bumperLB.position.y).toBeLessThan(initLB.pos.y);
    expect(bumperRB.position.y).toBeLessThan(initRB.pos.y);
    expect(btnBack.position.y).toBeLessThan(initBack.pos.y);
    expect(btnStart.position.y).toBeLessThan(initStart.pos.y);

    const recordsLB = viewer.partMaterials.get(bumperLB);
    expect(recordsLB[0].material.emissiveIntensity).toBeGreaterThan(1.0);
  });

  it('inclina o conjunto do D-Pad e deprime braços individuais ao pressionar cruz direcional', () => {
    const dpadGroup = viewer.parts.dpadGroup;
    const dpadUp = viewer.parts.dpadUp;
    const dpadLeft = viewer.parts.dpadLeft;

    const initGroup = viewer.initialTransforms.get(dpadGroup);
    const initUp = viewer.initialTransforms.get(dpadUp);

    const buttons = Array(17).fill({ pressed: false, value: 0 });
    buttons[12] = { pressed: true, value: 1.0 }; // Dpad Up

    viewer.updateInputs({ buttons });

    expect(dpadUp.position.y).toBeLessThan(initUp.pos.y);
    expect(dpadGroup.rotation.x).not.toBe(initGroup.rot.x);

    const upRecords = viewer.partMaterials.get(dpadUp);
    expect(upRecords[0].material.emissiveIntensity).toBeGreaterThan(1.0);
  });

  it('reage o LED central Guide / Nexus ring à conexão e pressionamento', () => {
    const targetGuide = viewer.parts.guideDisc || viewer.parts.buttonGuide;
    const records = viewer.partMaterials.get(targetGuide);
    expect(records).toBeDefined();

    // 1. Estado desconectado
    viewer.updateInputs({ connected: false, buttons: [] });
    expect(viewer.isConnected).toBe(false);
    expect(records[0].material.emissiveIntensity).toBeLessThan(0.3);

    // 2. Estado conectado ocioso
    viewer.updateInputs({ connected: true, buttons: [] });
    expect(viewer.isConnected).toBe(true);
    expect(records[0].material.emissiveIntensity).toBeGreaterThan(0.5);

    // 3. Botão Guide pressionado (botão 16)
    const buttons = Array(17).fill({ pressed: false, value: 0 });
    buttons[16] = { pressed: true, value: 1.0 };
    viewer.updateInputs({ connected: true, buttons });
    expect(records[0].material.emissiveIntensity).toBeGreaterThanOrEqual(2.0);
  });

  it('inclina o analógico e D-Pad na direção física anatômica correta (UP/DOWN/LEFT/RIGHT)', () => {
    const stickL = viewer.parts.stickL;
    const dpadGroup = viewer.parts.dpadGroup;
    const initStick = viewer.initialTransforms.get(stickL);
    const initDpad = viewer.initialTransforms.get(dpadGroup);

    // 1. Analógico para Cima (ly = -1.0) deve inclinar para frente (-Z, rotação.x < init.rot.x)
    viewer.updateInputs({ axes: [0, -1.0, 0, 0] });
    expect(stickL.rotation.x).toBeLessThan(initStick.rot.x);

    // 2. Analógico para Baixo (ly = +1.0) deve inclinar para trás (+Z, rotação.x > init.rot.x)
    viewer.updateInputs({ axes: [0, 1.0, 0, 0] });
    expect(stickL.rotation.x).toBeGreaterThan(initStick.rot.x);

    // 3. Analógico para Direita (lx = +1.0) deve inclinar para a direita (+X, rotação.z < init.rot.z)
    viewer.updateInputs({ axes: [1.0, 0, 0, 0] });
    expect(stickL.rotation.z).toBeLessThan(initStick.rot.z);

    // 4. Analógico para Esquerda (lx = -1.0) deve inclinar para a esquerda (-X, rotação.z > init.rot.z)
    viewer.updateInputs({ axes: [-1.0, 0, 0, 0] });
    expect(stickL.rotation.z).toBeGreaterThan(initStick.rot.z);

    // 5. D-Pad para Cima (botão 12) deve afundar o braço superior em -Z (rotação.x < init.rot.x)
    const btnUp = Array(17).fill({ pressed: false, value: 0 });
    btnUp[12] = { pressed: true, value: 1.0 };
    viewer.updateInputs({ buttons: btnUp });
    expect(dpadGroup.rotation.x).toBeLessThan(initDpad.rot.x);

    // 6. D-Pad para Baixo (botão 13) deve afundar o braço inferior em +Z (rotação.x > init.rot.x)
    const btnDown = Array(17).fill({ pressed: false, value: 0 });
    btnDown[13] = { pressed: true, value: 1.0 };
    viewer.updateInputs({ buttons: btnDown });
    expect(dpadGroup.rotation.x).toBeGreaterThan(initDpad.rot.x);

    // 7. D-Pad para Esquerda (botão 14) deve afundar o braço esquerdo em -X (rotação.z > init.rot.z)
    const btnLeft = Array(17).fill({ pressed: false, value: 0 });
    btnLeft[14] = { pressed: true, value: 1.0 };
    viewer.updateInputs({ buttons: btnLeft });
    expect(dpadGroup.rotation.z).toBeGreaterThan(initDpad.rot.z);

    // 8. D-Pad para Direita (botão 15) deve afundar o braço direito em +X (rotação.z < init.rot.z)
    const btnRight = Array(17).fill({ pressed: false, value: 0 });
    btnRight[15] = { pressed: true, value: 1.0 };
    viewer.updateInputs({ buttons: btnRight });
    expect(dpadGroup.rotation.z).toBeLessThan(initDpad.rot.z);
  });

  it('deprime todas as subpeças da cúpula do analógico (prato, aro, ranhuras) solidariamente no clique L3/R3', () => {
    const stickL = viewer.parts.stickL;
    const cap = stickL.getObjectByName('Stick_L_Cap');
    const dish = stickL.getObjectByName('Stick_L_Dish');
    const rim = stickL.getObjectByName('Stick_L_Rim');
    const groove = stickL.getObjectByName('Stick_L_Groove_0');

    expect(cap).toBeTruthy();
    expect(dish).toBeTruthy();
    expect(rim).toBeTruthy();
    expect(groove).toBeTruthy();

    const initCapY = cap.position.y;
    const initDishY = dish.position.y;
    const initRimY = rim.position.y;
    const initGrooveY = groove.position.y;

    const diffDish = initDishY - initCapY;
    const diffRim = initRimY - initCapY;
    const diffGroove = initGrooveY - initCapY;

    // Dispara L3 (botão 10)
    const buttons = Array(17).fill({ pressed: false, value: 0 });
    buttons[10] = { pressed: true, value: 1.0 };
    viewer.updateInputs({ buttons });

    // Todos devem afundar
    expect(cap.position.y).toBeLessThan(initCapY);
    expect(dish.position.y).toBeLessThan(initDishY);
    expect(rim.position.y).toBeLessThan(initRimY);
    expect(groove.position.y).toBeLessThan(initGrooveY);

    // As distâncias relativas entre cap, dish, rim e ranhuras devem ser estritamente preservadas (sem peças flutuando)
    expect(dish.position.y - cap.position.y).toBeCloseTo(diffDish, 4);
    expect(rim.position.y - cap.position.y).toBeCloseTo(diffRim, 4);
    expect(groove.position.y - cap.position.y).toBeCloseTo(diffGroove, 4);
  });

  it('restaura a cor emissiva original do disco Guide após ciclo de desconexão e reconexão', () => {
    const guideDisc = viewer.parts.guideDisc;
    expect(guideDisc).toBeTruthy();

    const records = viewer.partMaterials.get(guideDisc);
    const originalEmissiveHex = records[0].baseEmissive.getHexString();

    // Desconecta: altera a cor emissiva para cinza apagado
    viewer.updateInputs({ connected: false, buttons: [] });
    expect(records[0].material.emissive.getHexString()).toBe('334155');

    // Reconecta com inputs ativos: a cor emissiva base original púrpura DEVE ser restaurada
    viewer.updateInputs({ connected: true, axes: [0.5, 0] });
    expect(records[0].material.emissive.getHexString()).toBe(originalEmissiveHex);
  });

  it('executa simulação de rumble com harmônicos duplos e decaimento limpo para repouso', () => {
    viewer.triggerRumble(1.0);
    expect(viewer.rumbleIntensity).toBe(1.0);

    // Executa algumas iterações do render loop simulado
    viewer._renderLoop(100);
    expect(mockRenderer.render).toHaveBeenCalled();
    expect(viewer.rumbleIntensity).toBeLessThan(1.0);

    // Avança o decaimento até o repouso absoluto
    for (let t = 200; t < 15000; t += 100) {
      if (viewer.rumbleIntensity === 0) break;
      viewer._renderLoop(t);
    }

    expect(viewer.rumbleIntensity).toBe(0);
    expect(viewer.controllerGroup.position.x).toBe(0);
    expect(viewer.controllerGroup.position.y).toBe(0);
  });
});

describe('R3. On-Demand Render Loop & Resource Management', () => {
  let container;
  let canvas;
  let mockRenderer;
  let viewer;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    canvas = document.createElement('canvas');
    container.appendChild(canvas);
    document.body.appendChild(container);

    mockRenderer = createMockRenderer(canvas);
    viewer = new Gamepad3DViewer({
      container,
      canvas,
      renderer: mockRenderer,
      enableMouseTracking: true
    });
    viewer.init();
  });

  afterEach(() => {
    if (viewer) {
      viewer.destroy();
    }
    if (container && container.parentElement) {
      container.parentElement.removeChild(container);
    }
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('suspende o loop de renderização (0 FPS) quando ocioso sem hover nem inputs', () => {
    // Garante que o controle está em repouso
    viewer.mouse.isHovering = false;
    viewer.hasActiveInputs = false;
    viewer.rumbleIntensity = 0;
    viewer.controllerGroup.rotation.x = viewer.targetRotation.x;
    viewer.controllerGroup.rotation.y = viewer.targetRotation.y;
    viewer.controllerGroup.rotation.z = viewer.targetRotation.z;

    // Consome os settle frames
    for (let i = 0; i < 10; i++) {
      if (!viewer.isRendering) break;
      viewer._renderLoop(1000 + i * 16);
    }

    expect(viewer.isRendering).toBe(false);
    expect(viewer.animId).toBeNull();
  });

  it('acorda o loop de renderização sob interação do mouse e retorna ao repouso após saída', () => {
    // 1. Força repouso
    viewer.stop();
    expect(viewer.isRendering).toBe(false);

    // 2. Mouse enter / move deve acordar o loop
    viewer._onMouseEnter();
    expect(viewer.isRendering).toBe(true);
    expect(viewer.animId).not.toBeNull();

    // 3. Mouse move atualiza rotação alvo e continua renderizando
    viewer._onMouseMove({ clientX: 200, clientY: 100 });
    expect(viewer.mouse.isHovering).toBe(true);

    // 4. Mouse leave dispara retorno suave e eventual repouso
    viewer._onMouseLeave();
    expect(viewer.mouse.isHovering).toBe(false);

    // Simula a passagem de frames até que a rotação alinhe com baseRotation
    for (let i = 0; i < 80; i++) {
      if (!viewer.isRendering) break;
      viewer._renderLoop(2000 + i * 16);
    }

    expect(viewer.isRendering).toBe(false);
    expect(viewer.animId).toBeNull();
  });

  it('stop() desativa imediatamente o loop de animação e limpa animId', () => {
    viewer.start();
    expect(viewer.isRendering).toBe(true);
    expect(viewer.animId).not.toBeNull();

    viewer.stop();
    expect(viewer.isRendering).toBe(false);
    expect(viewer.animId).toBeNull();
  });

  it('destroy() libera listeners de eventos, materiais, geometrias e contexto WebGL sem erros', () => {
    const removeWindowSpy = vi.spyOn(window, 'removeEventListener');
    const removeTargetSpy = vi.spyOn(container, 'removeEventListener');

    viewer.destroy();

    expect(removeWindowSpy).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(removeTargetSpy).toHaveBeenCalledWith('mousemove', expect.any(Function));
    expect(removeTargetSpy).toHaveBeenCalledWith('mouseenter', expect.any(Function));
    expect(removeTargetSpy).toHaveBeenCalledWith('mouseleave', expect.any(Function));

    expect(mockRenderer.dispose).toHaveBeenCalled();
    expect(mockRenderer.forceContextLoss).toHaveBeenCalled();
    expect(viewer.renderer).toBeNull();
    expect(viewer.scene).toBeNull();
    expect(viewer.camera).toBeNull();
    expect(viewer.isInitialized).toBe(false);
    expect(viewer.isDestroyed).toBe(true);
    expect(viewer.animId).toBeNull();

    // Invocar destroy() repetidamente não deve quebrar
    expect(() => viewer.destroy()).not.toThrow();
  });

  it('mantém o loop em repouso (0 FPS) sob polling contínuo com entradas inalteradas', () => {
    // 1. Garante que está no repouso inicial com controle conectado
    viewer.mouse.isHovering = false;
    viewer.hasActiveInputs = false;
    viewer.rumbleIntensity = 0;
    viewer.controllerGroup.rotation.x = viewer.targetRotation.x;
    viewer.controllerGroup.rotation.y = viewer.targetRotation.y;
    viewer.controllerGroup.rotation.z = viewer.targetRotation.z;

    // Primeiro update registra a conexão e renderiza o frame inicial
    viewer.updateInputs({
      axes: [0, 0, 0, 0],
      buttons: [],
      connected: true
    });

    // Consome os settle frames do frame inicial
    for (let i = 0; i < 15; i++) {
      if (!viewer.isRendering) break;
      viewer._renderLoop(3000 + i * 16);
    }
    expect(viewer.isRendering).toBe(false);

    // 2. Simula o polling contínuo do Gamepad API a 60 FPS (ex: coop.js updateHud)
    // com o controle em repouso. O render loop NÃO DEVE acordar nem reiniciar.
    for (let i = 0; i < 30; i++) {
      viewer.updateInputs({
        axes: [0, 0, 0, 0],
        buttons: [],
        connected: true
      });
    }

    expect(viewer.isRendering).toBe(false);
    expect(viewer.animId).toBeNull();
  });

  it('impede que updateInputs ou resize acordem o loop de renderização após stop() com modal fechado', () => {
    viewer.stop();
    expect(viewer.isRendering).toBe(false);

    // Envio de inputs enquanto o modal está fechado não deve acordar o loop
    viewer.updateInputs({
      axes: [0.8, -0.6, 0, 0],
      buttons: [{ pressed: true, value: 1.0 }],
      connected: true
    });

    expect(viewer.isRendering).toBe(false);
    expect(viewer.animId).toBeNull();

    // Redimensionamento de janela enquanto fechado também não deve acordar
    viewer._onResize();
    expect(viewer.isRendering).toBe(false);
    expect(viewer.animId).toBeNull();

    // Reabertura do modal via start() deve restabelecer o funcionamento
    viewer.start();
    expect(viewer.isRendering).toBe(true);
    expect(viewer.animId).not.toBeNull();
  });

  it('trata entradas nulas ou vazias em updateInputs sem lançar exceções', () => {
    expect(() => viewer.updateInputs(null)).not.toThrow();
    expect(() => viewer.updateInputs(undefined)).not.toThrow();
    expect(() => viewer.updateInputs({})).not.toThrow();
    expect(() => viewer.updateInputs({ axes: null, buttons: null })).not.toThrow();
  });

  it('descarta adequadamente geometrias e materiais de modelos substituídos evitando vazamento de memória', () => {
    const dummyGeo = new THREE.BoxGeometry(1, 1, 1);
    const dummyMat = new THREE.MeshBasicMaterial();
    const disposeGeoSpy = vi.spyOn(dummyGeo, 'dispose');
    const disposeMatSpy = vi.spyOn(dummyMat, 'dispose');

    const dummyMesh = new THREE.Mesh(dummyGeo, dummyMat);
    viewer._disposeHierarchy(dummyMesh);

    expect(disposeGeoSpy).toHaveBeenCalled();
    expect(disposeMatSpy).toHaveBeenCalled();
  });

  it('mantém o loop em repouso (0 FPS) sob polling contínuo quando um botão é mantido pressionado sem alteração', () => {
    // 1. Pressiona o botão A
    viewer.updateInputs({
      axes: [0, 0, 0, 0],
      buttons: [{ pressed: true, value: 1.0 }],
      connected: true
    });

    expect(viewer.isRendering).toBe(true);

    // 2. Consome os settle frames do movimento do botão
    for (let i = 0; i < 15; i++) {
      if (!viewer.isRendering) break;
      viewer._renderLoop(4000 + i * 16);
    }

    // Deve entrar em repouso (0 FPS) mesmo com o botão A mantido pressionado
    expect(viewer.isRendering).toBe(false);
    expect(viewer.animId).toBeNull();
    expect(viewer.parts.buttonA.position.y).toBeLessThan(viewer.initialTransforms.get(viewer.parts.buttonA).pos.y);

    // 3. Simula polling contínuo com o botão A mantido pressionado: NÃO deve acordar o render loop
    for (let i = 0; i < 30; i++) {
      viewer.updateInputs({
        axes: [0, 0, 0, 0],
        buttons: [{ pressed: true, value: 1.0 }],
        connected: true
      });
    }

    expect(viewer.isRendering).toBe(false);
    expect(viewer.animId).toBeNull();

    // 4. Ao liberar o botão A, detecta a alteração, acorda e anima o retorno
    viewer.updateInputs({
      axes: [0, 0, 0, 0],
      buttons: [{ pressed: false, value: 0.0 }],
      connected: true
    });

    expect(viewer.isRendering).toBe(true);
    for (let i = 0; i < 15; i++) {
      if (!viewer.isRendering) break;
      viewer._renderLoop(5000 + i * 16);
    }
    expect(viewer.isRendering).toBe(false);
    expect(viewer.parts.buttonA.position.y).toBeCloseTo(viewer.initialTransforms.get(viewer.parts.buttonA).pos.y, 3);
  });

  it('mantém o loop em repouso (0 FPS) sob polling contínuo quando o analógico é mantido inclinado sem alteração', () => {
    // 1. Inclina o analógico esquerdo
    viewer.updateInputs({
      axes: [0.8, -0.6, 0, 0],
      buttons: [],
      connected: true
    });

    expect(viewer.isRendering).toBe(true);

    for (let i = 0; i < 15; i++) {
      if (!viewer.isRendering) break;
      viewer._renderLoop(6000 + i * 16);
    }

    expect(viewer.isRendering).toBe(false);
    expect(viewer.animId).toBeNull();

    // 2. Polling contínuo com a mesma inclinação não acorda
    for (let i = 0; i < 30; i++) {
      viewer.updateInputs({
        axes: [0.8, -0.6, 0, 0],
        buttons: [],
        connected: true
      });
    }

    expect(viewer.isRendering).toBe(false);
    expect(viewer.animId).toBeNull();
  });

  it('aplica deadzone radial nos analógicos evitando que ruído de potenciômetro acorde o loop', () => {
    viewer.updateInputs({ axes: [0, 0, 0, 0], buttons: [], connected: true });
    for (let i = 0; i < 15; i++) viewer._renderLoop(7000 + i * 16);
    expect(viewer.isRendering).toBe(false);

    // Jitter dentro da deadzone (< 0.06) não acorda o render loop e não desloca o analógico
    viewer.updateInputs({ axes: [0.03, -0.02, 0.01, -0.04], buttons: [], connected: true });
    expect(viewer.isRendering).toBe(false);
    expect(viewer.parts.stickL.rotation.x).toBeCloseTo(viewer.initialTransforms.get(viewer.parts.stickL).rot.x, 3);
  });

  it('sincroniza o estado de inputs e conexão imediatamente ao carregar/substituir o modelo 3D', () => {
    viewer.updateInputs({ connected: false, buttons: [] });
    const guideDisc = viewer.parts.guideDisc;
    expect(viewer.partMaterials.get(guideDisc)[0].material.emissive.getHexString()).toBe('334155');

    // Substitui o modelo simulando GLTF assíncrono
    const newModel = createGamepadModel();
    viewer._attachModel(newModel);

    // O modelo recém-anexado deve ter _lastInputs invalidado para que o próximo updateInputs aplique o estado
    viewer.updateInputs({ connected: false, buttons: [] });
    const newGuideDisc = viewer.parts.guideDisc;
    expect(viewer.partMaterials.get(newGuideDisc)[0].material.emissive.getHexString()).toBe('334155');
  });

  it('detecta quando o modal ancestral está oculto (display: none) e dorme a 0 FPS sem agendar loop', () => {
    const modalParent = document.createElement('div');
    modalParent.id = 'ancestor-modal';
    modalParent.style.display = 'none';

    const stageEl = document.createElement('div');
    const canvasEl = document.createElement('canvas');
    stageEl.appendChild(canvasEl);
    modalParent.appendChild(stageEl);
    document.body.appendChild(modalParent);

    const hiddenViewer = new Gamepad3DViewer({
      container: stageEl,
      canvas: canvasEl,
      renderer: createMockRenderer(canvasEl)
    });

    // Ao inicializar com modal pai oculto, _isElementHidden deve retornar true e NÃO renderizar
    hiddenViewer.init();
    expect(hiddenViewer._isElementHidden()).toBe(true);
    expect(hiddenViewer.isRendering).toBe(false);
    expect(hiddenViewer.animId).toBeNull();

    // Enviar inputs com modal pai oculto também não deve acordar o loop
    hiddenViewer.updateInputs({ axes: [1, 0, 0, 0], buttons: [], connected: true });
    expect(hiddenViewer.isRendering).toBe(false);
    expect(hiddenViewer.animId).toBeNull();

    // Ao exibir o modal ancestral, deve permitir start e renderizar
    modalParent.style.display = 'flex';
    expect(hiddenViewer._isElementHidden()).toBe(false);
    hiddenViewer.start();
    expect(hiddenViewer.isRendering).toBe(true);

    hiddenViewer.destroy();
    document.body.removeChild(modalParent);
  });

  it('sincroniza aspecto da câmera e dimensões ao invocar start() na abertura do modal', () => {
    // Configura canvas com novas dimensões simulando exibição do modal
    Object.defineProperty(canvas, 'clientWidth', { value: 480, configurable: true });
    Object.defineProperty(canvas, 'clientHeight', { value: 270, configurable: true });

    viewer.start();

    expect(mockRenderer.setSize).toHaveBeenCalledWith(480, 270, false);
    expect(viewer.camera.aspect).toBeCloseTo(480 / 270, 3);
  });

  it('higieniza entradas corrompidas com NaN, null e valores infinitos sem poluir matrizes 3D', () => {
    expect(() => {
      viewer.updateInputs({
        axes: [NaN, Infinity, -Infinity, 'invalid'],
        buttons: [{ pressed: true, value: NaN }, { pressed: false, value: Infinity }]
      });
    }).not.toThrow();

    expect(Number.isNaN(viewer.parts.stickL.rotation.x)).toBe(false);
    expect(Number.isNaN(viewer.parts.stickL.rotation.z)).toBe(false);
    expect(Number.isNaN(viewer.parts.stickR.rotation.x)).toBe(false);
    expect(Number.isNaN(viewer.parts.triggerLT.rotation.x)).toBe(false);
  });

  it('camada o tremor de vibração sobre a rotação de mouse-tracking sem truncar a interpolação', () => {
    viewer.controllerGroup.rotation.x = viewer.targetRotation.x;
    viewer.controllerGroup.rotation.y = viewer.targetRotation.y;
    viewer.controllerGroup.rotation.z = viewer.targetRotation.z;

    viewer.triggerRumble(1.0);
    expect(viewer.rumbleIntensity).toBe(1.0);

    // Executa frame com rumble ativo
    viewer._renderLoop(100);
    expect(viewer.controllerGroup.position.x).not.toBe(0);

    // Avança até o término do rumble
    for (let t = 200; t < 15000; t += 100) {
      if (viewer.rumbleIntensity === 0) break;
      viewer._renderLoop(t);
    }

    expect(viewer.rumbleIntensity).toBe(0);
    expect(viewer.controllerGroup.position.x).toBe(0);
    expect(viewer.controllerGroup.rotation.z).toBeCloseTo(viewer.targetRotation.z, 4);
  });
});
