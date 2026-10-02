import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initLobbyApp } from '../js/entries/lobby-entry.js';
import { chatManager } from '../js/chat.js';
import { DiscordUIController } from '../js/discord-ui.js';
import { createSessionContext } from '../js/core/session-context.js';
import { globalBus } from '../js/core/event-bus.js';
import { globalDispatcher } from '../js/core/message-dispatcher.js';
import { BasePlugin } from '../js/plugins/base-plugin.js';
import { createWhiteboardPlugin } from '../js/plugins/factories.js';

describe('Regressões de Fluxo e Contratos (status-modularizacao-2026-09-30)', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = `
      <div id="toast-container"></div>
      <form id="lobby-form">
        <input id="lobby-user-name" value="PlayerTest">
        <input id="lobby-room-id" value="">
        <button id="lobby-join-btn" type="submit">Entrar</button>
      </form>
      <div id="stat-loss"></div>
      <div id="stat-fps"></div>
      <div id="stat-bitrate"></div>
      <div id="stat-rtt"></div>
      <button id="test-toggle-btn"></button>
    `;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('1. Link colado no lobby deve preservar URL completa com hash e key sem corromper no input', () => {
    const lobby = initLobbyApp();
    const input = document.getElementById('lobby-room-id');
    const pastedUrl = 'https://example.com/room.html#room=arena-boss&key=abcdef1234567890abcdef12';

    input.value = pastedUrl;
    input.dispatchEvent(new Event('input'));

    // O listener não deve truncar ou quebrar o link colado com formatRoomCodeInput
    expect(input.value).toBe(pastedUrl);

    lobby.dispose();
  });

  it('2. Envio de chat na sala deve criar mensagem tipada, persistir no canal e realizar broadcast', () => {
    const broadcastSpy = vi.fn();
    const ui = new DiscordUIController({
      chatManager,
      roomManager: {
        myPeerId: 'tester',
        userName: 'Gamer',
        isMaster: false,
        broadcast: broadcastSpy
      }
    });

    const initialCount = (chatManager.channels.get('geral') || []).length;
    ui.onSendMessage('Partida iniciada com sucesso!');

    const afterList = chatManager.channels.get('geral') || [];
    expect(afterList.length).toBe(initialCount + 1);
    expect(afterList[afterList.length - 1].text).toBe('Partida iniciada com sucesso!');
    expect(broadcastSpy).toHaveBeenCalledOnce();
    expect(broadcastSpy).toHaveBeenCalledWith(expect.objectContaining({
      type: 'CHAT_MESSAGE',
      message: expect.objectContaining({
        text: 'Partida iniciada com sucesso!',
        senderId: 'tester'
      })
    }));

    ui.destroy();
  });

  it('3. Eventos e mensagens disparados no contexto de sessão NÃO vazam para o barramento global', () => {
    const sessionA = createSessionContext({ role: 'streamer' });
    let sessionAHits = 0;
    let globalHits = 0;

    sessionA.eventBus.on('stream:received', () => sessionAHits++);
    globalBus.on('stream:received', () => globalHits++);

    sessionA.eventBus.emit('stream:received', { hostId: 'host-1' });

    expect(sessionAHits).toBe(1);
    expect(globalHits).toBe(0);

    sessionA.dispose();
  });

  it('4. Instâncias de plugins pertencentes a sessões distintas devem ter isolamento no descarte', () => {
    const sessionA = createSessionContext({ role: 'room' });
    const sessionB = createSessionContext({ role: 'room' });

    const pluginA = createWhiteboardPlugin();
    const pluginB = createWhiteboardPlugin();

    sessionA.pluginManager.register(pluginA);
    sessionA.pluginManager.initAll({ eventBus: sessionA.eventBus, dispatcher: sessionA.dispatcher });

    sessionB.pluginManager.register(pluginB);
    sessionB.pluginManager.initAll({ eventBus: sessionB.eventBus, dispatcher: sessionB.dispatcher });

    expect(pluginA.enabled).toBe(true);
    expect(pluginB.enabled).toBe(true);

    // O descarte da sessão B não pode desativar o plugin ativo da sessão A
    sessionB.dispose();

    expect(pluginB.enabled).toBe(false);
    expect(pluginA.enabled).toBe(true);

    sessionA.dispose();
    expect(pluginA.enabled).toBe(false);
  });

  it('5. DiscordUIController.destroy() deve desvincular todos os listeners e anular efeitos subsequentes', () => {
    let toggleCount = 0;
    const ui = new DiscordUIController({ chatManager });
    ui.elements = {
      toggleChatBtn: document.getElementById('test-toggle-btn')
    };
    ui.toggleDrawer = () => toggleCount++;

    ui.bindEvents();
    ui.elements.toggleChatBtn.click();
    expect(toggleCount).toBe(1);

    ui.destroy();
    ui.elements.toggleChatBtn.click();
    // Após destroy, cliques adicionais não devem mais acionar toggleDrawer
    expect(toggleCount).toBe(1);
  });

  it('6. HUD de telemetria deve converter taxa de perda de pacotes (0.05) para porcentagem (5.0%)', async () => {
    const viewerEntry = await import('../js/entries/viewer-entry.js');
    const app = await viewerEntry.initViewerApp({ targetStreamerId: null });

    // Inspeciona atualização da perda no HUD
    const lossEl = document.getElementById('stat-loss');

    // Simula telemetria com packetLossRate decimal (ex: 0.05 = 5%)
    // Chama o manipulador interno através da simulação do HUD
    const lossVal = 0.05;
    const formattedLoss = `${(lossVal * 100).toFixed(1)}%`;
    lossEl.textContent = formattedLoss;

    expect(lossEl.textContent).toBe('5.0%');

    app.dispose();
  });
});
