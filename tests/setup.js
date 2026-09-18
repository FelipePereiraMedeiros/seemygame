import { vi } from 'vitest';
import { MockAudioContext } from './mocks/webaudio.mock.js';
import {
  MockRTCPeerConnection,
  MockRTCRtpSender,
  MockMediaStream,
  MockMediaStreamTrack
} from './mocks/webrtc.mock.js';

// Setup Web Audio
globalThis.AudioContext = MockAudioContext;
globalThis.webkitAudioContext = MockAudioContext;

// Polyfill innerText para JSDOM (mapeia bidirecionalmente para textContent)
Object.defineProperty(HTMLElement.prototype, 'innerText', {
  get() {
    return this.textContent;
  },
  set(value) {
    this.textContent = value;
  },
  configurable: true
});

// Setup WebRTC
globalThis.RTCPeerConnection = MockRTCPeerConnection;
globalThis.RTCRtpSender = MockRTCRtpSender;
globalThis.MediaStream = MockMediaStream;
globalThis.MediaStreamTrack = MockMediaStreamTrack;

// Setup Navigator MediaDevices
if (!navigator.mediaDevices) {
  Object.defineProperty(navigator, 'mediaDevices', {
    value: {
      getDisplayMedia: vi.fn(async () => new MockMediaStream([new MockMediaStreamTrack('video')])),
      getUserMedia: vi.fn(async () => new MockMediaStream())
    },
    writable: true,
    configurable: true
  });
} else if (!navigator.mediaDevices.getDisplayMedia) {
  navigator.mediaDevices.getDisplayMedia = vi.fn(async () => new MockMediaStream([new MockMediaStreamTrack('video')]));
}

// Setup Clipboard
if (!navigator.clipboard) {
  Object.defineProperty(navigator, 'clipboard', {
    value: {
      writeText: vi.fn(async () => Promise.resolve())
    },
    writable: true,
    configurable: true
  });
} else {
  navigator.clipboard.writeText = vi.fn(async () => Promise.resolve());
}

// Setup HTMLMediaElement methods (play, pause, pip, fullscreen, load)
window.HTMLMediaElement.prototype.play = vi.fn(async () => Promise.resolve());
window.HTMLMediaElement.prototype.pause = vi.fn();
window.HTMLMediaElement.prototype.load = vi.fn();
window.HTMLMediaElement.prototype.requestPictureInPicture = vi.fn(async () => Promise.resolve());
window.HTMLMediaElement.prototype.requestFullscreen = vi.fn(async () => Promise.resolve());
document.exitPictureInPicture = vi.fn(async () => Promise.resolve());

// Setup URL.createObjectURL / revokeObjectURL
if (!URL.createObjectURL) {
  URL.createObjectURL = vi.fn(() => 'blob:http://localhost/fake-uuid');
}
if (!URL.revokeObjectURL) {
  URL.revokeObjectURL = vi.fn();
}

// Setup requestAnimationFrame / cancelAnimationFrame
let nextRafId = 1;
const rafCallbacks = new Map();

globalThis.requestAnimationFrame = vi.fn((cb) => {
  const id = nextRafId++;
  const timerId = setTimeout(() => {
    rafCallbacks.delete(id);
    cb(performance.now());
  }, 16);
  rafCallbacks.set(id, timerId);
  return id;
});

globalThis.cancelAnimationFrame = vi.fn((id) => {
  if (rafCallbacks.has(id)) {
    clearTimeout(rafCallbacks.get(id));
    rafCallbacks.delete(id);
  }
});
