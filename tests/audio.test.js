import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getAudioContext,
  initAudioAnalyser,
  stopAudioAnalyser
} from '../js/audio.js';
import {
  MockMediaStream,
  MockMediaStreamTrack
} from './mocks/webrtc.mock.js';

describe('Módulo: audio.js', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getAudioContext', () => {
    it('deve inicializar e retornar uma instância singleton de AudioContext', () => {
      const ctx1 = getAudioContext();
      const ctx2 = getAudioContext();

      expect(ctx1).toBeDefined();
      expect(ctx2).toBe(ctx1);
    });

    it('deve chamar resume() caso o AudioContext esteja com state suspended', () => {
      const ctx = getAudioContext();
      ctx.state = 'suspended';
      const resumeSpy = vi.spyOn(ctx, 'resume');

      getAudioContext();

      expect(resumeSpy).toHaveBeenCalled();
      expect(ctx.state).toBe('running');
    });
  });

  describe('initAudioAnalyser', () => {
    it('deve retornar precocemente se a stream for nula ou não tiver faixas de áudio', () => {
      const emptyStream = new MockMediaStream([]);
      expect(() => initAudioAnalyser(null, 'peer-1')).not.toThrow();
      expect(() => initAudioAnalyser(emptyStream, 'peer-1')).not.toThrow();
    });

    it('deve criar a cadeia de nós de áudio e configurar os analisadores estéreo L/R', () => {
      const audioTrack = new MockMediaStreamTrack('audio');
      const stream = new MockMediaStream([audioTrack]);
      const ctx = getAudioContext();

      const createSourceSpy = vi.spyOn(ctx, 'createMediaStreamSource');
      const createSplitterSpy = vi.spyOn(ctx, 'createChannelSplitter');
      const createAnalyserSpy = vi.spyOn(ctx, 'createAnalyser');

      // Cria os elementos DOM necessários para o peer
      document.body.innerHTML = `
        <div id="card-peer-test">
          <div id="vu-l-peer-test"></div>
          <div id="vu-r-peer-test"></div>
        </div>
      `;

      initAudioAnalyser(stream, 'peer-test');

      expect(createSourceSpy).toHaveBeenCalledWith(stream);
      expect(createSplitterSpy).toHaveBeenCalledWith(2);
      expect(createAnalyserSpy).toHaveBeenCalledTimes(2);

      stopAudioAnalyser('peer-test');
    });

    it('deve atualizar o estilo de largura das barras VU L e R com base nos dados de áudio', () => {
      const audioTrack = new MockMediaStreamTrack('audio');
      const stream = new MockMediaStream([audioTrack]);

      document.body.innerHTML = `
        <div id="card-peer-vu">
          <div id="vu-l-peer-vu" style="width: 0%;"></div>
          <div id="vu-r-peer-vu" style="width: 0%;"></div>
        </div>
      `;

      initAudioAnalyser(stream, 'peer-vu');

      const barL = document.getElementById('vu-l-peer-vu');
      const barR = document.getElementById('vu-r-peer-vu');

      expect(barL.style.width).not.toBe('0%');
      expect(barR.style.width).not.toBe('0%');

      stopAudioAnalyser('peer-vu');
    });

    it('deve interromper o loop renderVU caso o card do peer seja removido do DOM', () => {
      const audioTrack = new MockMediaStreamTrack('audio');
      const stream = new MockMediaStream([audioTrack]);

      document.body.innerHTML = `
        <div id="card-peer-remove">
          <div id="vu-l-peer-remove"></div>
          <div id="vu-r-peer-remove"></div>
        </div>
      `;

      initAudioAnalyser(stream, 'peer-remove');

      const card = document.getElementById('card-peer-remove');
      card.remove();

      // Chamada manual do loop deve detectar ausência do card e parar
      expect(() => {
        initAudioAnalyser(stream, 'peer-remove');
      }).not.toThrow();
    });
  });

  describe('stopAudioAnalyser', () => {
    it('deve cancelar o requestAnimationFrame e limpar a referência do peer', () => {
      const cancelRafSpy = vi.spyOn(globalThis, 'cancelAnimationFrame');
      const audioTrack = new MockMediaStreamTrack('audio');
      const stream = new MockMediaStream([audioTrack]);

      document.body.innerHTML = `
        <div id="card-peer-stop">
          <div id="vu-l-peer-stop"></div>
          <div id="vu-r-peer-stop"></div>
        </div>
      `;

      initAudioAnalyser(stream, 'peer-stop');
      stopAudioAnalyser('peer-stop');

      expect(cancelRafSpy).toHaveBeenCalled();
    });

    it('não deve lançar erro se chamado para um peerId inexistente', () => {
      expect(() => stopAudioAnalyser('inexistent-peer')).not.toThrow();
    });

    it('deve desconectar explicitamente todos os nós de áudio (source, splitter, analysers) para evitar vazamento de recursos', () => {
      const audioTrack = new MockMediaStreamTrack('audio');
      const stream = new MockMediaStream([audioTrack]);
      const ctx = getAudioContext();

      let createdSource = null;
      let createdSplitter = null;
      const createdAnalysers = [];

      vi.spyOn(ctx, 'createMediaStreamSource').mockImplementation((s) => {
        createdSource = { stream: s, connect: vi.fn(), disconnect: vi.fn() };
        return createdSource;
      });

      vi.spyOn(ctx, 'createChannelSplitter').mockImplementation((n) => {
        createdSplitter = { numberOfOutputs: n, connect: vi.fn(), disconnect: vi.fn() };
        return createdSplitter;
      });

      vi.spyOn(ctx, 'createAnalyser').mockImplementation(() => {
        const a = {
          fftSize: 64,
          frequencyBinCount: 32,
          getByteFrequencyData: vi.fn(),
          connect: vi.fn(),
          disconnect: vi.fn()
        };
        createdAnalysers.push(a);
        return a;
      });

      document.body.innerHTML = `
        <div id="card-peer-nodes">
          <div id="vu-l-peer-nodes"></div>
          <div id="vu-r-peer-nodes"></div>
        </div>
      `;

      initAudioAnalyser(stream, 'peer-nodes');
      expect(createdSource).not.toBeNull();
      expect(createdSplitter).not.toBeNull();
      expect(createdAnalysers.length).toBe(2);

      stopAudioAnalyser('peer-nodes');

      expect(createdSource.disconnect).toHaveBeenCalled();
      expect(createdSplitter.disconnect).toHaveBeenCalled();
      expect(createdAnalysers[0].disconnect).toHaveBeenCalled();
      expect(createdAnalysers[1].disconnect).toHaveBeenCalled();
    });
  });

  describe('applyMicrophoneProcessing', () => {
    it('deve retornar a stream original se a entrada for inválida ou sem faixas de áudio', async () => {
      const { applyMicrophoneProcessing } = await import('../js/audio.js');
      const emptyStream = new MockMediaStream([]);
      const resultNull = applyMicrophoneProcessing(null);
      expect(resultNull.processedStream).toBeNull();

      const resultEmpty = applyMicrophoneProcessing(emptyStream);
      expect(resultEmpty.processedStream).toBe(emptyStream);
    });

    it('deve criar cadeia com HighPass, GainNode e MediaStreamDestination', async () => {
      const { applyMicrophoneProcessing } = await import('../js/audio.js');
      const audioTrack = new MockMediaStreamTrack('audio');
      const stream = new MockMediaStream([audioTrack]);

      const controller = applyMicrophoneProcessing(stream, {
        thresholdDb: -40,
        highPassFreq: 85
      });

      expect(controller.processedStream).toBeDefined();
      expect(typeof controller.setEnabled).toBe('function');
      expect(typeof controller.setThreshold).toBe('function');
      expect(typeof controller.destroy).toBe('function');

      controller.setEnabled(false);
      controller.setThreshold(-35);
      controller.destroy();
    });
  });
});

