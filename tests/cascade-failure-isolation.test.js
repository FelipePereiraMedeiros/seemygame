import { initLegacyBindings } from '../js/app.js';
import { describe, it, expect, vi } from 'vitest';
import { handleIncomingP2PMessage, p2pDispatcher, globalBus } from '../js/app.js';
import { chatManager } from '../js/chat.js';

describe('Fase 1: Prevenção de Falhas em Cascata (Blast Radius Containment)', () => {
  it('exceção em handler periférico (ex: Whiteboard ou Meme) NÃO derruba o despachante nem afeta mensagens subsequentes de chat/voz', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Registra um handler de teste que lança exceção proposital
    p2pDispatcher.register('FAULTY_PERIPHERAL', () => {
      throw new Error('Falha catastrófica simulada em periférico!');
    }, { priority: 10, description: 'Faulty Peripheral Test' });

    const systemErrorListener = vi.fn();
    globalBus.on('system:error', systemErrorListener);

    // 1. Envia a mensagem que falha
    expect(() => {
      handleIncomingP2PMessage({ type: 'FAULTY_PERIPHERAL', data: { corrupt: true } }, null);
    }).not.toThrow();

    // 2. Confirma que o despachante registrou a falha sem quebrar a pilha
    const metrics = p2pDispatcher.getMetrics();
    expect(metrics.errors).toBeGreaterThan(0);

    // 3. Envia mensagem crítica subsequente (ex: CHAT_MESSAGE) e confirma processamento normal
    const chatMsg = { id: 'chat-healthy-1', text: 'Chat continua funcionando perfeitamente!', sender: 'tester' };
    expect(() => {
      handleIncomingP2PMessage({ type: 'CHAT_MESSAGE', message: chatMsg }, null);
    }).not.toThrow();

    const list = chatManager.channels.get('geral') || [];
    const found = list.some(m => m.id === 'chat-healthy-1');
    expect(found).toBe(true);

    errorSpy.mockRestore();
  });
});

initLegacyBindings();
