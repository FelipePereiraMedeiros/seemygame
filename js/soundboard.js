import { createAudioScope } from './audio/context-scope.js';
/**
 * SeeMyGame - Módulo de Soundboard P2P na Sala de Voz
 * Sintetizador gamer via Web Audio API, sem arquivos externos e sincronizado via WebRTC.
 */

export const SOUNDBOARD_STORAGE_KEY = 'seemygame_custom_sounds';

export const SOUNDBOARD_PRESETS = [
  { id: 'victory', name: '🎺 Vitória', icon: '🎺' },
  { id: 'hitmark', name: '🎯 Headshot', icon: '🎯' },
  { id: 'airhorn', name: '📢 Airhorn', icon: '📢' },
  { id: 'laser', name: '👾 Laser 8-Bit', icon: '👾' },
  { id: 'boom', name: '💥 Boom Bass', icon: '💥' },
  { id: 'gg', name: '👏 GG', icon: '👏' }
];

export function base64ToArrayBuffer(base64) {
  if (!base64) return new ArrayBuffer(0);
  const clean = base64.includes(',') ? base64.split(',')[1] : base64;
  if (typeof atob === 'function') {
    const binary = atob(clean);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }
  if (typeof Buffer !== 'undefined') {
    const buf = Buffer.from(clean, 'base64');
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }
  return new ArrayBuffer(0);
}

export class SoundboardManager {
  constructor(options = {}) {
    this.audioContext = null;
    this._audioScope = options.audioScope || createAudioScope();
    this._ownsAudioScope = !options.audioScope;
    this.cooldownMs = options.cooldownMs || 1200;
    this.lastTriggerTime = 0;
    this.changeListeners = new Set();
    this.customSounds = this._loadCustomSounds();
  }

  _loadCustomSounds() {
    if (typeof window === 'undefined' || !window.localStorage) return [];
    try {
      const data = window.localStorage.getItem(SOUNDBOARD_STORAGE_KEY);
      if (!data) return [];
      const parsed = JSON.parse(data);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.warn('[Soundboard] Erro ao carregar sons customizados:', e);
      return [];
    }
  }

  _saveCustomSounds() {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      window.localStorage.setItem(SOUNDBOARD_STORAGE_KEY, JSON.stringify(this.customSounds));
    } catch (e) {
      console.warn('[Soundboard] Erro ao salvar sons customizados no localStorage:', e);
    }
  }

  getCustomSounds() {
    return [...this.customSounds];
  }

  addCustomSound({ name, audioBase64, icon = '🎙️', duration = 0 }) {
    if (!audioBase64) throw new Error('audioBase64 é obrigatório para salvar o som no Soundboard');
    const safeName = (name && String(name).trim()) || 'Meme Custom';
    const id = `custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const newSound = {
      id,
      name: safeName,
      icon: icon || '🎙️',
      audioBase64,
      duration: Math.max(0, Number(duration) || 0),
      createdAt: Date.now()
    };
    this.customSounds.unshift(newSound);
    if (this.customSounds.length > 40) {
      this.customSounds = this.customSounds.slice(0, 40);
    }
    this._saveCustomSounds();
    this._notifyChange();
    return newSound;
  }

  deleteCustomSound(soundId) {
    const prevLen = this.customSounds.length;
    this.customSounds = this.customSounds.filter(s => s.id !== soundId);
    if (this.customSounds.length !== prevLen) {
      this._saveCustomSounds();
      this._notifyChange();
      return true;
    }
    return false;
  }

  onChange(callback) {
    if (typeof callback === 'function') {
      this.changeListeners.add(callback);
      return () => this.changeListeners.delete(callback);
    }
    return () => {};
  }

  _notifyChange() {
    this.changeListeners.forEach(cb => {
      try { cb(this.getCustomSounds()); } catch (_) {}
    });
  }

  async playCustomSound(soundIdOrObject) {
    const sound = typeof soundIdOrObject === 'string'
      ? this.customSounds.find(s => s.id === soundIdOrObject)
      : soundIdOrObject;
    if (!sound || !sound.audioBase64) return false;

    const ctx = this._getAudioContext();
    if (!ctx) return false;

    try {
      const arrayBuf = base64ToArrayBuffer(sound.audioBase64);
      if (typeof ctx.decodeAudioData !== 'function') return false;
      const audioBuffer = await ctx.decodeAudioData(arrayBuf);
      if (!audioBuffer) return false;
      if (typeof ctx.createBufferSource === 'function') {
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);
        source.start(0);
      }
      return true;
    } catch (err) {
      console.warn('[Soundboard] Erro ao reproduzir som customizado:', err);
      return false;
    }
  }

  _getAudioContext() {
    if (typeof window === 'undefined') return null;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    if (!this.audioContext) {
      this.audioContext = this._audioScope.getContext('playback');
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
    if (typeof soundId === 'string' && soundId.startsWith('custom_')) {
      const sound = this.customSounds.find(s => s.id === soundId);
      if (sound) {
        this.playCustomSound(sound);
        return true;
      }
      return false;
    }

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

  dispose() {
    this.changeListeners.clear();
    if (this.audioContext) {
      if (this._ownsAudioScope) this._audioScope.dispose().catch(() => {});
      this.audioContext = null;
    }
  }
}

export const soundboardManager = new SoundboardManager();
