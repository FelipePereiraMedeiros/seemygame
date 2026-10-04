import { SOUNDBOARD_PRESETS } from ".././soundboard.js";
import { EMOJI_REACTION_PRESETS } from './shared.js';
/** DiscordUIController: soundboard. State and lifetime remain owned by the composed engine. */
export const withDiscordUIControllerSoundboard = Base => class extends Base {
initSoundboard() {
    const grid = this.elements.soundboardGrid;
    if (!grid) return;
    grid.innerHTML = '';

    // Seção 1: Presets Gamer Sintetizados
    const presetSection = document.createElement('div');
    presetSection.className = 'soundboard-section';
    presetSection.innerHTML = `<div class="soundboard-section-title"><span>🔊</span> Sons Gamer Rápidos</div>`;
    const presetGrid = document.createElement('div');
    presetGrid.className = 'soundboard-grid';

    SOUNDBOARD_PRESETS.forEach((preset) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'soundboard-btn';
      btn.dataset.soundId = preset.id;
      btn.innerHTML = `
        <span class="sound-emoji">${preset.icon || preset.emoji || '🔊'}</span>
        <span class="sound-name">${preset.name}</span>
      `;
      this.listen(btn, 'click', () => {
        this.onPlaySound(preset.id);
      });
      presetGrid.appendChild(btn);
    });
    presetSection.appendChild(presetGrid);
    grid.appendChild(presetSection);

    // Seção 2: Memes Customizados Salvos no SeeMyGame
    const customSection = document.createElement('div');
    customSection.className = 'soundboard-section soundboard-custom-section';
    const customSounds = this.soundboardManager.getCustomSounds();

    customSection.innerHTML = `
      <div class="soundboard-section-title">
        <span>⭐</span> Meus Memes Salvos (${customSounds.length})
      </div>
    `;

    if (customSounds.length === 0) {
      const emptyHint = document.createElement('div');
      emptyHint.className = 'soundboard-empty-hint';
      emptyHint.innerHTML = `
        <span>💡</span> Grave um clipe na sala e clique em <strong>"⭐ Salvar no Soundboard"</strong> para guardar seus memes aqui!
      `;
      customSection.appendChild(emptyHint);
    } else {
      const customGrid = document.createElement('div');
      customGrid.className = 'soundboard-grid soundboard-custom-grid';

      customSounds.forEach((sound) => {
        const item = document.createElement('div');
        item.className = 'soundboard-custom-item';

        const durText = sound.duration ? `${sound.duration.toFixed(1)}s` : '';
        item.innerHTML = `
          <button type="button" class="soundboard-btn soundboard-custom-btn" data-sound-id="${sound.id}" title="Tocar ${sound.name} na sala de voz">
            <span class="sound-emoji">${sound.icon || '🎙️'}</span>
            <span class="sound-name">${sound.name}</span>
            ${durText ? `<span class="sound-duration-tag">${durText}</span>` : ''}
          </button>
          <button type="button" class="soundboard-delete-btn" data-sound-id="${sound.id}" title="Excluir este meme">✕</button>
        `;

        const playBtn = item.querySelector('.soundboard-custom-btn');
        if (playBtn) {
          this.listen(playBtn, 'click', () => {
            this.onPlayCustomSound(sound);
          });
        }

        const deleteBtn = item.querySelector('.soundboard-delete-btn');
        if (deleteBtn) {
          this.listen(deleteBtn, 'click', (e) => {
            e.stopPropagation();
            const shouldDelete = typeof confirm === 'function' ? confirm(`Excluir o som "${sound.name}" do Soundboard?`) : true;
            if (shouldDelete) {
              this.soundboardManager.deleteCustomSound(sound.id);
            }
          });
        }

        customGrid.appendChild(item);
      });
      customSection.appendChild(customGrid);
    }

    grid.appendChild(customSection);
  }

initEmojis() {
    const grid = this.elements.emojisGrid;
    if (!grid) return;
    grid.innerHTML = '';
    EMOJI_REACTION_PRESETS.forEach((preset) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'emoji-reaction-card';
      card.dataset.emoji = preset.emoji;
      card.setAttribute('data-emoji', preset.emoji);
      card.title = `Disparar reação ${preset.emoji} (${preset.name})`;
      card.innerHTML = `
        <span class="emoji-icon">${preset.emoji}</span>
        <span class="emoji-name">${preset.name}</span>
        <span class="emoji-desc">${preset.desc}</span>
      `;
      this.listen(card, 'click', () => {
        this.onSendReaction(preset.emoji);
      });
      grid.appendChild(card);
    });
  }
};
