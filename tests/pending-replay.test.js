import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { Blob as NodeBlob } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClipRecorder } from '../js/clipping.js';

const fixture = readFileSync(resolve('tests/fixtures/replay-red-then-blue.webm'));
const FRAME_BYTES = 16 * 16 * 3;
function findWingetFfmpeg() {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return null;
  const base = resolve(localAppData, 'Microsoft', 'WinGet', 'Packages');
  try {
    if (!existsSync(base)) return null;
    for (const dir of readdirSync(base)) {
      if (/ffmpeg/i.test(dir)) {
        const pkgDir = resolve(base, dir);
        for (const sub of readdirSync(pkgDir)) {
          const bin = resolve(pkgDir, sub, 'bin', 'ffmpeg.exe');
          if (existsSync(bin)) return bin;
        }
      }
    }
  } catch (_) {}
  return null;
}

function resolveFfmpegBin() {
  if (process.env.FFMPEG_BIN) return process.env.FFMPEG_BIN;
  const wingetBin = findWingetFfmpeg();
  const candidates = [
    ...(wingetBin ? [wingetBin] : []),
    'ffmpeg',
    'C:\\Users\\diogo\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.0.1-full_build\\bin\\ffmpeg.exe'
  ];
  for (const bin of candidates) {
    try {
      const check = spawnSync(bin, ['-version'], { windowsHide: true });
      if (check.status === 0) return bin;
    } catch (_) {}
  }
  return 'ffmpeg';
}
const resolvedFfmpeg = resolveFfmpegBin();

function decode(bytes) {
  const result = spawnSync(resolvedFfmpeg, [
    '-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-map', '0:v:0',
    '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'
  ], { input: bytes, timeout: 15000, maxBuffer: 1024 * 1024, windowsHide: true });
  if (result.error) throw new Error(`FFmpeg obrigatório para validar clipes: ${result.error.message}`);
  expect(result.status, result.stderr.toString()).toBe(0);
  expect(result.stdout.length % FRAME_BYTES).toBe(0);
  const frames = [];
  for (let i = 0; i < result.stdout.length; i += FRAME_BYTES) frames.push([...result.stdout.subarray(i, i + 3)]);
  return frames;
}

class EncodedRecorder {
  static isTypeSupported = () => true;
  constructor() { EncodedRecorder.current = this; this.mimeType = 'video/webm'; }
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; }
  emit(bytes) { this.ondataavailable({ data: new NodeBlob([bytes], { type: this.mimeType }) }); }
}

describe('Pendência: validade do replay após descarte circular', () => {
  let recorder;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('MediaRecorder', EncodedRecorder);
    vi.stubGlobal('Blob', NodeBlob);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    recorder = new ClipRecorder({ maxDurationSeconds: 3 });
  });
  afterEach(() => {
    recorder.stop();
    vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
  });

  it('controle: fixture real decodifica oito frames, um vermelho e sete azuis', () => {
    const frames = decode(fixture);
    expect(frames).toHaveLength(8);
    expect(frames[0][0]).toBeGreaterThan(200);
    expect(frames.slice(1).every(rgb => rgb[2] > 200 && rgb[0] < 20)).toBe(true);
  });

  it('exporta somente imagens recentes, sem ressuscitar o primeiro frame descartado', async () => {
    // Fixture conhecida: 8 clusters de um frame/keyframe, sem áudio.
    // Não é um parser EBML genérico. A contagem e o decode são pré-condições.
    const marker = Buffer.from([0x1f, 0x43, 0xb6, 0x75]);
    const offsets = [];
    for (let at = fixture.indexOf(marker); at >= 0; at = fixture.indexOf(marker, at + 4)) offsets.push(at);
    expect(offsets).toHaveLength(8);
    recorder.start({ getTracks: () => [] });
    for (let i = 0; i < offsets.length; i++) {
      vi.setSystemTime(100000 + i * 1000);
      EncodedRecorder.current.emit(fixture.subarray(i === 0 ? 0 : offsets[i], offsets[i + 1] ?? fixture.length));
    }
    const output = await recorder.exportClip('replay-test');
    expect(output).toBeTruthy();
    const frames = decode(Buffer.from(await output.arrayBuffer()));
    expect(frames.length).toBeGreaterThan(0);
    expect.soft(frames.length).toBeLessThanOrEqual(4); // 3s + uma borda de amostragem
    expect(frames.every(rgb => rgb[2] > 200 && rgb[0] < 20),
      'O replay recente não pode conter o frame vermelho do início da gravação').toBe(true);
  });
});
