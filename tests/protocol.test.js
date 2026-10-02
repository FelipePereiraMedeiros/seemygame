import { describe, it, expect } from 'vitest';
import {
  PROTOCOL_TYPES,
  createMessageEnvelope,
  isValidMessageEnvelope,
  AdmissionGate
} from '../js/protocol/index.js';

describe('Protocol: Mensageria P2P, Envelopes e Portão de Admissão', () => {
  describe('PROTOCOL_TYPES', () => {
    it('deve conter definições congeladas para todas as categorias de mensagens', () => {
      expect(PROTOCOL_TYPES.ADMISSION.PIN_REQUIRED).toBe('PIN_REQUIRED');
      expect(PROTOCOL_TYPES.MEDIA.REQUEST_STREAM).toBe('REQUEST_STREAM');
      expect(PROTOCOL_TYPES.SIGNALING.START_DIRECT_STREAM).toBe('START_DIRECT_STREAM');
      expect(PROTOCOL_TYPES.COMMUNICATION.CHAT_MESSAGE).toBe('CHAT_MESSAGE');
      expect(PROTOCOL_TYPES.COOP.COOP_INPUT).toBe('COOP_INPUT');
      expect(PROTOCOL_TYPES.FEATURES.WHITEBOARD_SYNC).toBe('WHITEBOARD_SYNC');
      expect(Object.isFrozen(PROTOCOL_TYPES)).toBe(true);
    });
  });

  describe('createMessageEnvelope e isValidMessageEnvelope', () => {
    it('deve gerar envelope com msgId, timestamp e payload integrados', () => {
      const envelope = createMessageEnvelope(PROTOCOL_TYPES.COMMUNICATION.CHAT_MESSAGE, {
        text: 'Olá mundo'
      }, { senderPeerId: 'peer-123' });

      expect(envelope.type).toBe('CHAT_MESSAGE');
      expect(envelope.text).toBe('Olá mundo');
      expect(envelope.senderPeerId).toBe('peer-123');
      expect(envelope.msgId).toMatch(/^msg_/);
      expect(typeof envelope.timestamp).toBe('number');
    });

    it('isValidMessageEnvelope deve validar envelopes íntegros e rejeitar dados corrompidos', () => {
      expect(isValidMessageEnvelope({ type: 'PING' })).toBe(true);
      expect(isValidMessageEnvelope(null)).toBe(false);
      expect(isValidMessageEnvelope({})).toBe(false);
      expect(isValidMessageEnvelope({ type: '' })).toBe(false);
      expect(isValidMessageEnvelope('string')).toBe(false);
    });

    it('createMessageEnvelope deve lançar erro se tipo for inválido', () => {
      expect(() => createMessageEnvelope('')).toThrow(TypeError);
      expect(() => createMessageEnvelope(null)).toThrow(TypeError);
    });
  });

  describe('AdmissionGate', () => {
    it('deve permitir acesso irrestrito quando sala não possui PIN nem chave', () => {
      const gate = new AdmissionGate();
      expect(gate.isAuthenticated('guest-1')).toBe(true);
      expect(gate.validateAuthAttempt()).toBe(true);
    });

    it('deve exigir PIN e validar credenciais corretamente', () => {
      const gate = new AdmissionGate({ roomPin: '1234' });
      expect(gate.isAuthenticated('guest-1')).toBe(false);

      expect(gate.validateAuthAttempt({ pin: '0000' })).toBe(false);
      expect(gate.validateAuthAttempt({ pin: '1234' })).toBe(true);

      gate.authenticate('guest-1');
      expect(gate.isAuthenticated('guest-1')).toBe(true);

      gate.revoke('guest-1');
      expect(gate.isAuthenticated('guest-1')).toBe(false);
    });

    it('deve exigir roomKey quando configurada', () => {
      const gate = new AdmissionGate({ roomKey: 'secret-key-xyz' });
      expect(gate.isAuthenticated('guest-2')).toBe(false);

      expect(gate.validateAuthAttempt({ key: 'wrong' })).toBe(false);
      expect(gate.validateAuthAttempt({ key: 'secret-key-xyz' })).toBe(true);
    });
  });
});
