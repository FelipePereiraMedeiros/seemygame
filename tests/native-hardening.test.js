import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { 
  setMaxCoopPlayers, 
  getMaxCoopPlayers, 
  setPartyModeEnabled, 
  isPartyModeEnabled, 
  getCoopState, 
  handleHostCoopMessage, 
  registerCoopPromptHandler, 
  revokeAllCoopPlayers,
  reconcileCoopSlots
} from '../js/coop.js';
import { 
  applyLiveBitrateChange, 
  roomManager 
} from '../js/app.js';
import { RoomManager } from '../js/room.js';

describe('Fase 4: Endurecimento da Camada Nativa Desktop e Reconciliação (R1 a R10)', () => {
  let mockInvoke;

  beforeEach(() => {
    vi.useFakeTimers();
    mockInvoke = vi.fn().mockResolvedValue({
      state: 'live',
      session_id: 'session-hardening-1',
      width: 1920,
      height: 1080,
      fps: 60,
      video_codec: 'h264',
      h264_encoder: 'auto',
      audio_mode: 'system'
    });

    globalThis.__TAURI_INTERNALS__ = {
      invoke: mockInvoke
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    delete globalThis.__TAURI_INTERNALS__;
    revokeAllCoopPlayers();
    vi.restoreAllMocks();
  });

  describe('R10: Reconciliação de Slots Co-op ao Reduzir Limites', () => {
    it('deve revogar automaticamente slots excedentes ao reduzir maxCoopPlayers de 4 para 2', async () => {
      setMaxCoopPlayers(4);
      const conn1 = { send: vi.fn(), open: true };
      const conn2 = { send: vi.fn(), open: true };
      const conn3 = { send: vi.fn(), open: true };

      registerCoopPromptHandler(({ approve }) => approve());
      handleHostCoopMessage('p2-peer', { type: 'COOP_REQUEST', name: 'Player2' }, conn1); // slot 1
      handleHostCoopMessage('p3-peer', { type: 'COOP_REQUEST', name: 'Player3' }, conn2); // slot 2
      handleHostCoopMessage('p4-peer', { type: 'COOP_REQUEST', name: 'Player4' }, conn3); // slot 3

      // Aguarda resolução de plugVirtualGamepad (Tauri invoke)
      await vi.advanceTimersByTimeAsync(50);

      expect(getCoopState().activeSlotsCount).toBe(3);

      // Reduz de 4 para 2 jogadores (modo 2P: maxCoopPlayers = 1, slots permitidos: 0 e 1)
      setMaxCoopPlayers(1);

      // Slots 2 e 3 devem ter sido revogados com notificação COOP_REVOKE
      expect(conn2.send).toHaveBeenCalledWith({ type: 'COOP_REVOKE' });
      expect(conn3.send).toHaveBeenCalledWith({ type: 'COOP_REVOKE' });
      expect(conn1.send).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'COOP_REVOKE' }));

      // Apenas o Player 2 (slot 1) deve permanecer ativo
      expect(getCoopState().activeSlotsCount).toBe(1);
      expect(getCoopState().activePlayer2PeerId).toBe('p2-peer');
    });

    it('ao desativar Modo Party, deve revogar imediatamente o convidado remoto do Slot 0 (P1)', async () => {
      setMaxCoopPlayers(4);
      setPartyModeEnabled(true);

      const connHostRemote = { send: vi.fn(), open: true };
      registerCoopPromptHandler(({ approve }) => approve());

      // Convidado entra no slot 0 (Player 1 remoto em party mode)
      handleHostCoopMessage('guest-p1', { type: 'COOP_REQUEST', name: 'GuestHost' }, connHostRemote);
      await vi.advanceTimersByTimeAsync(50);

      expect(connHostRemote.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'COOP_CAPABILITIES', slot: 0 }));

      // Desativa modo party
      setPartyModeEnabled(false);

      // Slot 0 deve ser revogado para restaurar exclusividade do Host
      expect(connHostRemote.send).toHaveBeenCalledWith({ type: 'COOP_REVOKE' });
      expect(isPartyModeEnabled()).toBe(false);
    });
  });

  describe('R5: Prevenção de Transmissão Fantasma (Phantom Streaming)', () => {
    it('applyLiveBitrateChange não deve publicar transmissão nem emitir ROOM_STREAM_PUBLISHED se não houver captura ativa', () => {
      // Cria uma instância de RoomManager para simular usuário conectado na sala mas ocioso (sem transmitir)
      const mockPeer = { id: 'idle-peer', on: vi.fn(), connect: vi.fn() };
      const rm = new RoomManager(mockPeer, 'sala-teste', 'IdleUser');
      const broadcastSpy = vi.spyOn(rm, 'broadcast');
      const emitSpy = vi.spyOn(rm, 'emit');

      // Injeta temporariamente o roomManager no módulo app
      const originalRoom = (window.roomManager || null);
      window.roomManager = rm;

      // Executa alteração de bitrate com usuário apenas na sala (sem localStream nem captura desktop ativa)
      applyLiveBitrateChange();

      // Confirma que NÃO foi anunciado stream fantasma
      expect(rm.localStreamingState.isStreaming).toBe(false);
      expect(broadcastSpy).not.toHaveBeenCalledWith(expect.objectContaining({
        type: 'ROOM_STREAM_PUBLISHED'
      }));
      expect(emitSpy).not.toHaveBeenCalledWith('streamPublished', expect.anything());

      window.roomManager = originalRoom;
    });
  });

  describe('R1 & R2: Contrato IPC Desktop e Salvaguardas de Topologia', () => {
    it('startNativeCapture deve repassar audioMode e videoCodec corretamente', async () => {
      const { startNativeCapture } = await import('../js/desktop.js');
      await startNativeCapture({
        sourceId: 'display:0',
        audioMode: 'none',
        videoCodec: 'h264',
        width: 1920,
        height: 1080,
        fps: 60,
        bitrateKbps: 7500
      });

      expect(mockInvoke).toHaveBeenCalledWith('start_native_capture', expect.objectContaining({
        sourceId: 'display:0',
        audioMode: 'none',
        videoCodec: 'h264'
      }));
    });

    it('reconfigureNativeCapture deve manter consistência de tipos e parâmetros', async () => {
      const { reconfigureNativeCapture } = await import('../js/desktop.js');
      await reconfigureNativeCapture({
        sessionId: 'session-hardening-1',
        audioMode: 'system',
        bitrateKbps: 9000,
        fps: 60
      });

      expect(mockInvoke).toHaveBeenCalledWith('reconfigure_native_capture', expect.objectContaining({
        sessionId: 'session-hardening-1',
        audioMode: 'system',
        bitrateKbps: 9000,
        fps: 60
      }));
    });
  });
});
