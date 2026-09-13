import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  setCoopEnabled,
  getCoopState,
  handleHostCoopMessage,
  revokePlayer2,
  releaseCoopControl,
  handleViewerCoopMessage,
  registerCoopPromptHandler
} from '../js/coop.js';

describe('Módulo: coop.js', () => {
  beforeEach(() => {
    setCoopEnabled(true);
    revokePlayer2();
  });

  it('deve alternar estado de coop habilitado / desabilitado', () => {
    setCoopEnabled(false);
    expect(getCoopState().isCoopEnabled).toBe(false);

    setCoopEnabled(true);
    expect(getCoopState().isCoopEnabled).toBe(true);
  });

  it('deve recusar COOP_REQUEST se Co-op estiver desabilitado', () => {
    setCoopEnabled(false);
    const mockConn = { send: vi.fn() };

    handleHostCoopMessage('peer-viewer-1', { type: 'COOP_REQUEST' }, mockConn);

    expect(mockConn.send).toHaveBeenCalledWith({
      type: 'COOP_RESPONSE',
      approved: false,
      reason: expect.stringContaining('desativou')
    });
  });

  it('deve disparar prompt de autorização para o streamer aprovar Player 2', () => {
    const mockConn = { send: vi.fn() };
    let promptData = null;

    registerCoopPromptHandler((data) => {
      promptData = data;
    });

    handleHostCoopMessage('viewer-player-2', { type: 'COOP_REQUEST' }, mockConn);

    expect(promptData).not.toBeNull();
    expect(promptData.peerId).toBe('viewer-player-2');

    // Host aprova
    promptData.approve();

    expect(mockConn.send).toHaveBeenCalledWith({
      type: 'COOP_RESPONSE',
      approved: true
    });
    expect(getCoopState().activePlayer2PeerId).toBe('viewer-player-2');
  });

  it('deve recusar novo Player 2 se já houver um conectado', () => {
    const mockConn1 = { send: vi.fn() };
    const mockConn2 = { send: vi.fn() };

    registerCoopPromptHandler(({ approve }) => approve());

    handleHostCoopMessage('p2-first', { type: 'COOP_REQUEST' }, mockConn1);
    expect(getCoopState().activePlayer2PeerId).toBe('p2-first');

    handleHostCoopMessage('p2-second', { type: 'COOP_REQUEST' }, mockConn2);
    expect(mockConn2.send).toHaveBeenCalledWith({
      type: 'COOP_RESPONSE',
      approved: false,
      reason: expect.stringContaining('Já existe um Player 2')
    });
  });

  it('deve permitir revogar Player 2 via killswitch / revokePlayer2', () => {
    const mockConn = { send: vi.fn() };
    registerCoopPromptHandler(({ approve }) => approve());

    handleHostCoopMessage('p2-target', { type: 'COOP_REQUEST' }, mockConn);
    expect(getCoopState().activePlayer2PeerId).toBe('p2-target');

    revokePlayer2();
    expect(getCoopState().activePlayer2PeerId).toBeNull();
    expect(mockConn.send).toHaveBeenCalledWith({ type: 'COOP_REVOKE' });
  });

  it('deve despachar eventos de teclado disparados pelo Player 2 autorizado', () => {
    const mockConn = { send: vi.fn() };
    registerCoopPromptHandler(({ approve }) => approve());
    handleHostCoopMessage('p2-gamer', { type: 'COOP_REQUEST' }, mockConn);

    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    handleHostCoopMessage('p2-gamer', {
      type: 'INPUT_KEY',
      action: 'down',
      key: 'w',
      code: 'KeyW',
      keyCode: 87
    }, mockConn);

    expect(dispatchSpy).toHaveBeenCalled();
    const event = dispatchSpy.mock.calls[0][0];
    expect(event.type).toBe('keydown');
    expect(event.key).toBe('w');

    dispatchSpy.mockRestore();
  });

  it('deve ignorar inputs de espectadores não autorizados', () => {
    const mockConn = { send: vi.fn() };
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    handleHostCoopMessage('unauthorized-user', {
      type: 'INPUT_KEY',
      action: 'down',
      key: 'a'
    }, mockConn);

    expect(dispatchSpy).not.toHaveBeenCalled();
    dispatchSpy.mockRestore();
  });

  it('lado do espectador: deve tratar resposta aprovada e iniciar escutas', () => {
    const mockCard = document.createElement('div');
    const mockVideo = document.createElement('video');
    mockCard.appendChild(mockVideo);

    handleViewerCoopMessage({ type: 'COOP_RESPONSE', approved: true }, 'host-id-1', mockCard);
    expect(getCoopState().isPlayer2).toBe(true);

    releaseCoopControl();
    expect(getCoopState().isPlayer2).toBe(false);
  });

  it('lado do espectador: deve atualizar estado do botão ao receber COOP_CONFIG', () => {
    const mockCard = document.createElement('div');
    const coopBtn = document.createElement('button');
    coopBtn.id = 'btn-coop-host-id-1';
    coopBtn.className = 'card-btn card-btn-coop';
    mockCard.appendChild(coopBtn);

    // Streamer desativa co-op
    handleViewerCoopMessage({ type: 'COOP_CONFIG', enabled: false }, 'host-id-1', mockCard);
    expect(coopBtn.disabled).toBe(true);
    expect(coopBtn.classList.contains('btn-disabled')).toBe(true);

    // Streamer reativa co-op
    handleViewerCoopMessage({ type: 'COOP_CONFIG', enabled: true }, 'host-id-1', mockCard);
    expect(coopBtn.disabled).toBe(false);
    expect(coopBtn.classList.contains('btn-disabled')).toBe(false);
  });
});
