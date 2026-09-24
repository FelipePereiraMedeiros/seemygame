import { describe, it, expect, vi, beforeEach } from 'vitest';
import { showToast } from '../js/ui.js';
import { voiceManager } from '../js/voice.js';
import { setupGamepadTesterModal } from '../js/coop.js';
import { MockMediaStream, MockMediaStreamTrack } from './mocks/webrtc.mock.js';

describe('Suíte de Testes: Correções de Flood de Toasts, Calibração de Gamepad e Sala de Voz', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="toast-container"></div>
      <button id="open-gamepad-tester-btn">Testar & Calibrar</button>
      <div id="gamepad-tester-modal" style="display: none;">
        <button id="close-gamepad-tester-btn">✕</button>
        <button id="done-gamepad-tester-btn">Concluir</button>
        <button id="test-rumble-btn">Testar Vibração</button>
        <select id="gamepad-select"></select>
        <span id="gamepad-sticks-label"></span>
        <span id="gamepad-triggers-label"></span>
        <span id="gamepad-buttons-label"></span>
        <div id="gamepad-driver-status-box">
          <span id="gamepad-driver-status-text"></span>
        </div>
        <select id="gamepad-mapping-preset"></select>
        <span id="gamepad-mapping-status"></span>
      </div>
    `;
    voiceManager.leaveVoice();
    vi.clearAllMocks();
  });

  it('showToast deve desduplicar mensagens idênticas consecutivas e limitar toasts simultâneos a 4', () => {
    const container = document.getElementById('toast-container');

    // Emite a mesma mensagem 5 vezes consecutivas
    for (let i = 0; i < 5; i++) {
      showToast('Qualidade ajustada pelo streamer: 720p • 4.5 Mbps', 'info');
    }

    // Graças à desduplicação, deve existir exatamente 1 toast no container
    expect(container.querySelectorAll('.toast').length).toBe(1);

    // Emite mensagens distintas para testar o teto de 4
    showToast('Mensagem B', 'info');
    showToast('Mensagem C', 'info');
    showToast('Mensagem D', 'info');
    showToast('Mensagem E', 'info'); // 5ª mensagem distinta

    // Deve respeitar o limite máximo de 4 toasts visíveis
    expect(container.querySelectorAll('.toast').length).toBeLessThanOrEqual(4);
    // A primeira mensagem mais antiga foi descartada em favor das novas
    const texts = Array.from(container.querySelectorAll('.toast span')).map(s => s.textContent);
    expect(texts).not.toContain('Qualidade ajustada pelo streamer: 720p • 4.5 Mbps');
    expect(texts).toContain('Mensagem E');
  });

  it('setupGamepadTesterModal deve registrar eventos e abrir o modal ao clicar em open-gamepad-tester-btn', () => {
    setupGamepadTesterModal();

    const openBtn = document.getElementById('open-gamepad-tester-btn');
    const modal = document.getElementById('gamepad-tester-modal');
    const closeBtn = document.getElementById('close-gamepad-tester-btn');

    expect(modal.style.display).toBe('none');

    // Clica no botão de testar/calibrar
    openBtn.click();
    expect(modal.style.display).toBe('flex');

    // Clica para fechar
    closeBtn.click();
    expect(modal.style.display).toBe('none');
  });

  it('voiceManager.addRemoteParticipant deve suportar tanto MediaStream direto quanto objeto estruturado com áudio', () => {
    const track = new MockMediaStreamTrack('audio');
    const mockStream = new MockMediaStream([track]);

    // Caso 1: Chamada passando MediaStream diretamente
    const ok1 = voiceManager.addRemoteParticipant('peer-alpha', mockStream);
    expect(ok1).toBe(true);

    const participants = voiceManager.getParticipantsList();
    const p1 = participants.find(p => p.peerId === 'peer-alpha');
    expect(p1).toBeDefined();
    expect(p1.stream).toBe(mockStream);
    expect(p1.audioElem).not.toBeNull();

    // Caso 2: Chamada passando opções estruturadas
    const ok2 = voiceManager.addRemoteParticipant('peer-beta', {
      name: 'Gamer 2',
      role: 'member',
      stream: mockStream
    });
    expect(ok2).toBe(true);

    const p2 = voiceManager.getParticipantsList().find(p => p.peerId === 'peer-beta');
    expect(p2).toBeDefined();
    expect(p2.name).toBe('Gamer 2');
    expect(p2.stream).toBe(mockStream);
  });
});
