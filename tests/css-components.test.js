import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Fase 3: Componentização e Modularização de CSS (css/components)', () => {
  const root = path.resolve('.');
  const cssDir = path.join(root, 'css');
  const componentsDir = path.join(cssDir, 'components');

  const componentFiles = [
    'video-grid.css',
    'hud-telemetry.css',
    'discord-drawer.css',
    'whiteboard.css',
    'modals.css'
  ];

  it('deve possuir todos os 5 arquivos de componentes CSS criados e com conteúdo substancial', () => {
    for (const file of componentFiles) {
      const filePath = path.join(componentsDir, file);
      expect(fs.existsSync(filePath), `Arquivo ${file} deve existir`).toBe(true);

      const stat = fs.statSync(filePath);
      expect(stat.size, `Arquivo ${file} deve conter regras CSS (> 500 bytes)`).toBeGreaterThan(500);
    }
  });

  it('css/player.css deve importar todos os 5 arquivos modulares via @import', () => {
    const playerCssPath = path.join(cssDir, 'player.css');
    const content = fs.readFileSync(playerCssPath, 'utf8');

    for (const file of componentFiles) {
      expect(content).toContain(`@import './components/${file}';`);
    }
  });

  it('video-grid.css deve conter regras da grade de vídeo, controles de co-op e overlays', () => {
    const content = fs.readFileSync(path.join(componentsDir, 'video-grid.css'), 'utf8');
    expect(content).toContain('.video-grid');
    expect(content).toContain('.video-card');
    expect(content).toContain('.video-wrapper');
    expect(content).toContain('.vu-meter-container');
    expect(content).toContain('.card-btn-coop');
    expect(content).toContain('.facecam-overlay');
  });

  it('hud-telemetry.css deve conter regras de HUD de estatísticas e badge de ABR', () => {
    const content = fs.readFileSync(path.join(componentsDir, 'hud-telemetry.css'), 'utf8');
    expect(content).toContain('.stats-hud');
    expect(content).toContain('.stats-row');
    expect(content).toContain('.abr-badge');
  });

  it('discord-drawer.css deve conter mini-rail, drawer retrátil, voz, chat e stage do room', () => {
    const content = fs.readFileSync(path.join(componentsDir, 'discord-drawer.css'), 'utf8');
    expect(content).toContain('.discord-drawer');
    expect(content).toContain('.discord-left-rail');
    expect(content).toContain('.voice-panel');
    expect(content).toContain('.chat-panel');
    expect(content).toContain('.room-sidebar');
    expect(content).toContain('.room-stage');
    expect(content).toContain('.dock-btn');
  });

  it('whiteboard.css deve conter regras da lousa colaborativa, canvas e ferramentas', () => {
    const content = fs.readFileSync(path.join(componentsDir, 'whiteboard.css'), 'utf8');
    expect(content).toContain('.whiteboard-overlay');
    expect(content).toContain('.whiteboard-topbar');
    expect(content).toContain('.whiteboard-tools');
    expect(content).toContain('.whiteboard-stylebar');
    expect(content).toContain('.whiteboard-canvas');
  });

  it('modals.css deve conter modais de window picker, green room e gamepad tester', () => {
    const content = fs.readFileSync(path.join(componentsDir, 'modals.css'), 'utf8');
    expect(content).toContain('.window-item');
    expect(content).toContain('.green-room-modal-content');
    expect(content).toContain('.share-room-modal-content');
    expect(content).toContain('.gamepad-tester-content');
    expect(content).toContain('.gamepad-visual');
  });
});
