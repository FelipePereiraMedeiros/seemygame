/**
 * SeeMyGame - Módulo de Soundboard P2P na Sala de Voz
 * Sintetizador gamer via Web Audio API, sem arquivos externos e sincronizado via WebRTC.
 */

export const SOUNDBOARD_PRESETS = [
  { id: 'victory', name: '🎺 Vitória', icon: '🎺' },
  { id: 'hitmark', name: '🎯 Headshot', icon: '🎯' },
  { id: 'airhorn', name: '📢 Airhorn', icon: '📢' },
  { id: 'laser', name: '👾 Laser 8-Bit', icon: '👾' },
  { id: 'boom', name: '💥 Boom Bass', icon: '💥' },
  { id: 'gg', name: '👏 GG', icon: '👏' }
];

export class SoundboardManager {
  constructor(options = {}) {
    this.audioContext = null;
    this.cooldownMs = options.cooldownMs || 1200;
    this.lastTriggerTime = 0;
  }

  _getAudioContext() {
    if (typeof window === 'undefined') return null;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    if (!this.audioContext) {
      this.audioContext = new AudioCtx();
    }
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume().catch(() => {});
    }
    return this.audioContext;
  }

  canPlay() {
    const now = Date.now();
    if (now - this.lastTriggerTime >= this.cooldownMs) {
      this.lastTriggerTime = now;
      return true;
    }
    return false;
  }

  /**
   * Toca o efeito sonoro sintetizado pelo ID
   * @param {string} soundId
   */
  playSound(soundId) {
    const ctx = this._getAudioContext();
    if (!ctx) return false;

    const t = ctx.currentTime;

    switch (soundId) {
      case 'victory': {
        // Fanfarra arpejada C5 (523Hz), E5 (659Hz), G5 (784Hz), C6 (1046Hz)
        const notes = [523.25, 659.25, 783.99, 1046.5];
        notes.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, t + idx * 0.1);

          gain.gain.setValueAtTime(0, t + idx * 0.1);
          gain.gain.linearRampToValueAtTime(0.2, t + idx * 0.1 + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.001, t + idx * 0.1 + 0.35);

          osc.connect(gain);
          gain.connect(ctx.destination);

          osc.start(t + idx * 0.1);
          osc.stop(t + idx * 0.1 + 0.36);
        });
        return true;
      }

      case 'hitmark': {
        // Bip agudo e limpo de headshot
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1800, t);
        osc.frequency.exponentialRampToValueAtTime(800, t + 0.08);

        gain.gain.setValueAtTime(0.3, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(t);
        osc.stop(t + 0.09);
        return true;
      }

      case 'airhorn': {
        // Famoso acorde de Airhorn (3 tons em intervalo de buzina)
        const freqs = [466.16, 587.33, 698.46]; // Bb4, D5, F5
        freqs.forEach(freq => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(freq, t);

          gain.gain.setValueAtTime(0.12, t);
          gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);

          osc.connect(gain);
          gain.connect(ctx.destination);

          osc.start(t);
          osc.stop(t + 0.42);
        });
        return true;
      }

      case 'laser': {
        // Sweep descendente 8-bit
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(1200, t);
        osc.frequency.exponentialRampToValueAtTime(100, t + 0.22);

        gain.gain.setValueAtTime(0.2, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(t);
        osc.stop(t + 0.23);
        return true;
      }

      case 'boom': {
        // Grave 808 Sub-bass drop
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(140, t);
        osc.frequency.exponentialRampToValueAtTime(32, t + 0.45);

        gain.gain.setValueAtTime(0.35, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(t);
        osc.stop(t + 0.46);
        return true;
      }

      case 'gg': {
        // Acorde animado de encerramento GG
        const freqs = [392.0, 523.25, 659.25]; // G4, C5, E5
        freqs.forEach(freq => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, t);

          gain.gain.setValueAtTime(0.2, t);
          gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);

          osc.connect(gain);
          gain.connect(ctx.destination);

          osc.start(t);
          osc.stop(t + 0.52);
        });
        return true;
      }

      default:
        return false;
    }
  }
}

export const soundboardManager = new SoundboardManager();
