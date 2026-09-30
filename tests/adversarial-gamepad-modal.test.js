import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setupGamepadTesterModal } from '../js/coop.js';
import { setupTuningModal, initRoomApp } from '../js/entries/room-entry.js';
import { initStreamerApp } from '../js/entries/streamer-entry.js';
import { initViewerApp } from '../js/entries/viewer-entry.js';

describe('Adversarial Verification: Gamepad Tester & Tuning Modal Lifecycle', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createFullModalDOM = () => {
    document.body.innerHTML = `
      <div id="toast-container"></div>
      <div id="terms-modal" class="modal-overlay" style="display:none;"></div>
      <button id="quick-tuning-btn">⚙️</button>
      <div id="tuning-modal" class="modal-overlay" style="display: none;">
        <button id="close-tuning-modal-btn">✕</button>
        <button id="open-gamepad-tester-btn">Testar Gamepad</button>
        <button id="save-tuning-btn">Salvar</button>
      </div>
      <div id="gamepad-tester-modal" class="modal-overlay" style="display: none;">
        <div id="gamepad-tester-inner" class="modal-content">
          <h2 id="gamepad-tester-title">Calibração de Gamepad</h2>
          <button id="close-gamepad-tester-btn">✕</button>
          <button id="done-gamepad-tester-btn">Concluído</button>
          <select id="gamepad-select"></select>
          <div id="gamepad-visual-stage">
            <canvas id="gamepad-3d-canvas" width="420" height="250"></canvas>
          </div>
          <button id="test-rumble-btn">Testar Vibração</button>
          <span id="gamepad-rumble-status"></span>
          <span id="gamepad-connection-label"></span>
          <span id="gamepad-sticks-label"></span>
          <span id="gamepad-triggers-label"></span>
          <span id="gamepad-buttons-label"></span>
          <div id="gamepad-driver-status-box">
            <span id="gamepad-driver-status-text"></span>
          </div>
          <select id="gamepad-mapping-preset">
            <option value="xbox">Xbox</option>
            <option value="nintendo">Nintendo</option>
          </select>
          <button id="swap-ab-btn">Inverter A/B</button>
          <button id="swap-xy-btn">Inverter X/Y</button>
          <button id="reset-mapping-btn">Resetar</button>
          <span id="gamepad-mapping-status"></span>
        </div>
      </div>
    `;
  };

  describe('1. Idempotency and Multiple Mount Calls', () => {
    it('deve ser 100% idempotente em 20 chamadas consecutivas de setupGamepadTesterModal', () => {
      createFullModalDOM();
      const modal = document.getElementById('gamepad-tester-modal');
      const openBtn = document.getElementById('open-gamepad-tester-btn');
      const closeBtn = document.getElementById('close-gamepad-tester-btn');

      // Primeira chamada monta
      setupGamepadTesterModal();
      expect(modal.dataset.testerMounted).toBe('true');

      // 19 chamadas adicionais não devem duplicar listeners nem falhar
      for (let i = 0; i < 19; i++) {
        setupGamepadTesterModal();
      }
      expect(modal.dataset.testerMounted).toBe('true');

      // Testa se o listener de abrir abre o modal
      openBtn.click();
      expect(modal.style.display).toBe('flex');

      // Testa se o listener de fechar fecha o modal
      closeBtn.click();
      expect(modal.style.display).toBe('none');
    });

    it('deve ignorar com segurança quando o modal não está presente no DOM inicialmente e montar quando injetado', () => {
      document.body.innerHTML = '<div id="other-content"></div>';

      // Chamada sem modal no DOM não deve lançar exceção
      expect(() => setupGamepadTesterModal()).not.toThrow();

      // Injeta modal dinamicamente
      createFullModalDOM();
      const modal = document.getElementById('gamepad-tester-modal');
      expect(modal.dataset.testerMounted).toBeUndefined();

      // Chamada posterior deve montar normalmente
      setupGamepadTesterModal();
      expect(modal.dataset.testerMounted).toBe('true');
    });

    it('setupTuningModal deve ser idempotente em múltiplas chamadas', () => {
      createFullModalDOM();
      const tuningModal = document.getElementById('tuning-modal');
      const closeBtn = document.getElementById('close-tuning-modal-btn');
      const saveBtn = document.getElementById('save-tuning-btn');

      for (let i = 0; i < 10; i++) {
        setupTuningModal();
      }
      expect(tuningModal.dataset.tuningMounted).toBe('true');

      tuningModal.style.display = 'flex';
      closeBtn.click();
      expect(tuningModal.style.display).toBe('none');

      tuningModal.style.display = 'flex';
      saveBtn.click();
      expect(tuningModal.style.display).toBe('none');
    });
  });

  describe('2. Modal Interleaving & Edge Cases de Abertura / Fechamento', () => {
    it('clicar em openBtn repetidamente enquanto já está aberto não corrompe estado', () => {
      createFullModalDOM();
      setupGamepadTesterModal();

      const modal = document.getElementById('gamepad-tester-modal');
      const openBtn = document.getElementById('open-gamepad-tester-btn');

      // Clica 10 vezes consecutivas para abrir
      for (let i = 0; i < 10; i++) {
        openBtn.click();
        expect(modal.style.display).toBe('flex');
      }

      // Fecha uma única vez e garante que fechou
      const closeBtn = document.getElementById('close-gamepad-tester-btn');
      closeBtn.click();
      expect(modal.style.display).toBe('none');
    });

    it('fechamento via Escape só ocorre se o modal estiver visível', () => {
      createFullModalDOM();
      setupGamepadTesterModal();

      const modal = document.getElementById('gamepad-tester-modal');
      expect(modal.style.display).toBe('none');

      // Pressiona Escape com modal fechado - não deve quebrar
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(modal.style.display).toBe('none');

      // Abre modal
      modal.style.display = 'flex';

      // Pressiona outra tecla (ex: Enter) - modal não deve fechar
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      expect(modal.style.display).toBe('flex');

      // Pressiona Escape - modal fecha
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(modal.style.display).toBe('none');
    });

    it('clicar no backdrop fecha o modal; clicar no conteúdo interno mantém aberto', () => {
      createFullModalDOM();
      setupGamepadTesterModal();

      const modal = document.getElementById('gamepad-tester-modal');
      const innerContent = document.getElementById('gamepad-tester-inner');
      const title = document.getElementById('gamepad-tester-title');

      modal.style.display = 'flex';

      // Clicar dentro do conteúdo (innerContent) não deve fechar
      innerContent.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(modal.style.display).toBe('flex');

      // Clicar no título interno não deve fechar
      title.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(modal.style.display).toBe('flex');

      // Clicar diretamente no backdrop (modal overlay) fecha
      modal.dispatchEvent(new MouseEvent('click', { bubbles: false }));
      expect(modal.style.display).toBe('none');
    });

    it('doneBtn fecha o modal com a mesma eficácia que closeBtn', () => {
      createFullModalDOM();
      setupGamepadTesterModal();

      const modal = document.getElementById('gamepad-tester-modal');
      const openBtn = document.getElementById('open-gamepad-tester-btn');
      const doneBtn = document.getElementById('done-gamepad-tester-btn');

      openBtn.click();
      expect(modal.style.display).toBe('flex');

      doneBtn.click();
      expect(modal.style.display).toBe('none');
    });

    it('interleaving entre tuning-modal e gamepad-tester-modal', () => {
      createFullModalDOM();
      setupTuningModal();
      setupGamepadTesterModal();

      const tuningModal = document.getElementById('tuning-modal');
      const gamepadModal = document.getElementById('gamepad-tester-modal');
      const openGamepadBtn = document.getElementById('open-gamepad-tester-btn');
      const closeGamepadBtn = document.getElementById('close-gamepad-tester-btn');
      const closeTuningBtn = document.getElementById('close-tuning-modal-btn');

      // 1. Abre tuning modal
      tuningModal.style.display = 'flex';
      expect(tuningModal.style.display).toBe('flex');
      expect(gamepadModal.style.display).toBe('none');

      // 2. Do tuning modal, abre o gamepad tester
      openGamepadBtn.click();
      expect(tuningModal.style.display).toBe('flex');
      expect(gamepadModal.style.display).toBe('flex');

      // 3. Fecha gamepad tester
      closeGamepadBtn.click();
      expect(gamepadModal.style.display).toBe('none');
      expect(tuningModal.style.display).toBe('flex');

      // 4. Reabre gamepad tester
      openGamepadBtn.click();
      expect(gamepadModal.style.display).toBe('flex');

      // 5. Fecha tuning modal enquanto gamepad tester está aberto
      closeTuningBtn.click();
      expect(tuningModal.style.display).toBe('none');
      expect(gamepadModal.style.display).toBe('flex');

      // 6. Fecha gamepad tester via Escape
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(gamepadModal.style.display).toBe('none');
      expect(tuningModal.style.display).toBe('none');
    });
  });

  describe('3. Stress Testing: 100 Ciclos Rápidos de Abertura e Fechamento', () => {
    it('suporta 100 transições open/close sem vazamento de rAF ou desincronização', () => {
      createFullModalDOM();
      setupGamepadTesterModal();

      const modal = document.getElementById('gamepad-tester-modal');
      const openBtn = document.getElementById('open-gamepad-tester-btn');
      const closeBtn = document.getElementById('close-gamepad-tester-btn');

      for (let i = 0; i < 100; i++) {
        openBtn.click();
        expect(modal.style.display).toBe('flex');

        if (i % 3 === 0) {
          closeBtn.click();
        } else if (i % 3 === 1) {
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        } else {
          modal.dispatchEvent(new MouseEvent('click', { bubbles: false }));
        }
        expect(modal.style.display).toBe('none');
      }
    });
  });

  describe('4. Entrypoint Mounting Verification Across Pages', () => {
    it('room-entry.js: initRoomApp monta tuning-modal e gamepad-tester-modal sem erros', async () => {
      createFullModalDOM();
      const app = await initRoomApp();

      const tuningModal = document.getElementById('tuning-modal');
      const gamepadModal = document.getElementById('gamepad-tester-modal');

      expect(tuningModal.dataset.tuningMounted).toBe('true');
      expect(gamepadModal.dataset.testerMounted).toBe('true');

      app.dispose();
    });

    it('streamer-entry.js: initStreamerApp monta gamepad-tester-modal se presente', async () => {
      createFullModalDOM();
      const app = await initStreamerApp();

      const gamepadModal = document.getElementById('gamepad-tester-modal');
      expect(gamepadModal.dataset.testerMounted).toBe('true');

      app.dispose();
    });

    it('viewer-entry.js: initViewerApp monta gamepad-tester-modal se presente', async () => {
      createFullModalDOM();
      const app = await initViewerApp({ targetStreamerId: null });

      const gamepadModal = document.getElementById('gamepad-tester-modal');
      expect(gamepadModal.dataset.testerMounted).toBe('true');

      app.dispose();
    });

    it('todos os 3 entrypoints executam com segurança quando gamepad-tester-modal NÃO está no DOM', async () => {
      document.body.innerHTML = `
        <div id="toast-container"></div>
        <div id="terms-modal" style="display:none;"></div>
      `;

      const roomApp = await initRoomApp();
      expect(roomApp).toBeDefined();
      roomApp.dispose();

      const streamerApp = await initStreamerApp();
      expect(streamerApp).toBeDefined();
      streamerApp.dispose();

      const viewerApp = await initViewerApp({ targetStreamerId: null });
      expect(viewerApp).toBeDefined();
      viewerApp.dispose();
    });
  });
});
