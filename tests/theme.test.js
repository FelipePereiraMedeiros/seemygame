import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve('js/theme.js'), 'utf8');
const markup = `<meta name="theme-color" content="#101216"><button data-theme-toggle><span class="theme-toggle-label"></span></button>`;

function openPage(savedTheme, { blockedStorage = false } = {}) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: 'https://seemygame.test/lobby.html', runScripts: 'outside-only',
  });
  const { window } = dom;
  if (savedTheme != null) window.localStorage.setItem('smg-theme', savedTheme);
  if (blockedStorage) Object.defineProperty(window, 'localStorage', { get() { throw new Error('Storage blocked'); } });
  window.eval(source);
  const initialTheme = window.document.documentElement.dataset.theme;
  window.document.body.innerHTML = markup;
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  return { dom, window, initialTheme, button: window.document.querySelector('button') };
}

describe('Shared web and desktop theme preference', () => {
  it.each(['dark', 'light'])('restores %s before rendering the page', theme => {
    const { dom, window, initialTheme, button } = openPage(theme);
    expect(initialTheme).toBe(theme);
    expect(button.getAttribute('aria-pressed')).toBe(String(theme === 'light'));
    expect(button.getAttribute('aria-label')).toBe(theme === 'light' ? 'Ativar tema escuro' : 'Ativar tema claro');
    expect(window.document.querySelector('meta').content).toBe(theme === 'light' ? '#eaf1f5' : '#101216');
    dom.window.close();
  });

  it('persists toggling and restores that preference on another page', () => {
    const first = openPage();
    first.button.click();
    expect(first.window.document.documentElement.dataset.theme).toBe('light');
    expect(first.button.textContent).toBe('Tema escuro');
    const next = openPage(first.window.localStorage.getItem('smg-theme'));
    expect(next.initialTheme).toBe('light');
    next.button.click();
    expect(next.window.localStorage.getItem('smg-theme')).toBe('dark');
    first.dom.window.close();
    next.dom.window.close();
  });

  it('synchronizes another tab and returns to the default when the preference is cleared', () => {
    const { dom, window, button } = openPage();
    window.dispatchEvent(new window.StorageEvent('storage', { key: 'smg-theme', newValue: 'light' }));
    expect(window.document.documentElement.dataset.theme).toBe('light');
    expect(button.getAttribute('aria-pressed')).toBe('true');
    window.dispatchEvent(new window.StorageEvent('storage', { key: 'unrelated', newValue: 'dark' }));
    expect(window.document.documentElement.dataset.theme).toBe('light');
    window.dispatchEvent(new window.StorageEvent('storage', { key: 'smg-theme', newValue: null }));
    expect(window.document.documentElement.dataset.theme).toBe('dark');
    dom.window.close();
  });

  it('keeps toggling available with blocked storage or an invalid saved preference', () => {
    const invalid = openPage('invalid');
    expect(invalid.initialTheme).toBe('dark');
    const blocked = openPage(null, { blockedStorage: true });
    blocked.button.click();
    expect(blocked.window.document.documentElement.dataset.theme).toBe('light');
    invalid.dom.window.close();
    blocked.dom.window.close();
  });
});
