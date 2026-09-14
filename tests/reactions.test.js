import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FloatingReactionsManager, ALLOWED_REACTIONS } from '../js/reactions.js';

describe('Módulo: reactions.js (FloatingReactionsManager)', () => {
  let manager;
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    manager = new FloatingReactionsManager({ container });
  });

  it('deve validar apenas reações permitidas na lista oficial', () => {
    expect(manager.isValidReaction('🔥')).toBe(true);
    expect(manager.isValidReaction('GG')).toBe(true);
    expect(manager.isValidReaction('invalid')).toBe(false);
    expect(manager.isValidReaction('<script>')).toBe(false);
  });

  it('deve criar elemento de reação no container', () => {
    const el = manager.spawnReaction({ emoji: '🔥', xPercent: 50, senderName: 'Diogo' });
    expect(el).not.toBeNull();
    expect(container.contains(el)).toBe(true);
    expect(el.style.left).toBe('50%');
    expect(el.textContent).toContain('🔥');
    expect(el.textContent).toContain('Diogo');
  });

  it('deve renderizar o badge estilizado para reação GG', () => {
    const el = manager.spawnReaction({ emoji: 'GG' });
    expect(el).not.toBeNull();
    const badge = el.querySelector('.reaction-gg-badge');
    expect(badge).not.toBeNull();
    expect(badge.textContent).toBe('GG');
  });

  it('deve respeitar o limite máximo de reações simultâneas', () => {
    manager.maxConcurrent = 2;
    manager.spawnReaction({ emoji: '🔥' });
    manager.spawnReaction({ emoji: '💀' });
    const third = manager.spawnReaction({ emoji: '🎯' });

    expect(third).toBeNull();
    expect(manager.activeReactionsCount).toBe(2);
  });

  it('canSend() deve respeitar o cooldown anti-spam', () => {
    manager.cooldownMs = 500;
    expect(manager.canSend()).toBe(true);
    expect(manager.canSend()).toBe(false); // Bloqueado pelo cooldown
  });
});
