import { describe, it, expect } from 'vitest';
import { webmHeader, rebaseWebmClusters } from '../js/clipping/webm-timeline.js';
import { nativeReplayContext } from '../js/clipping/native-context.js';
const marker = [0x1f, 0x43, 0xb6, 0x75];
const block = (track = 2, key = true, payload = [11]) => [0xa3, 0x80 | (4 + payload.length), 0x80 | track, 0xff, 0xfb, key ? 0x80 : 0, ...payload];
const cluster = (time, key = true, payload) => [...marker, 0xff, 0xe7, 0x82, time >> 8, time & 255, ...block(2, key, payload), ...block(1)];
describe('Circular WebM export clock and decodable start', () => {
  it('reads the video track number from Tracks rather than assuming track 1', () => {
    const tracks = [0x16, 0x54, 0xae, 0x6b, 0x88, 0xae, 0x86, 0xd7, 0x81, 2, 0x83, 0x81, 1];
    const header = [0x1a, 0x45, 0xdf, 0xa3, 0x80, 0x18, 0x53, 0x80, 0x67, 0xff, ...tracks];
    const result = webmHeader(new Uint8Array([...header, ...cluster(4000)]));
    expect(result.videoTrack).toBe(2); expect([...result.header]).toEqual(header);
  });
  it('drops delta-only clusters, rebases timestamps and preserves signed audio/video offsets', () => {
    const output = rebaseWebmClusters(new Uint8Array([99, 98, ...cluster(4000, false), ...cluster(6000), ...cluster(6500)]), 2);
    const expected = [...cluster(0), ...cluster(500)];
    expect([...output]).toEqual(expected);
    expect([...output.slice(11, 15)]).toEqual([0x82, 0xff, 0xfb, 0x80]);
  });
  it('does not parse marker-like compressed payload bytes as a cluster', () => {
    const bytes = new Uint8Array([...cluster(5000, true, [...marker, 0xff, 0xe7, 0x81, 99]), ...cluster(6000)]);
    expect([...rebaseWebmClusters(bytes, 2)]).toEqual([...cluster(0, true, [...marker, 0xff, 0xe7, 0x81, 99]), ...cluster(1000)]);
  });
  it('rejects audio-only keyframes and malformed data instead of exporting a frozen clip', () => {
    expect(() => rebaseWebmClusters(new Uint8Array(cluster(5000, false)), 2)).toThrow('quadro-chave');
    expect(() => rebaseWebmClusters(new Uint8Array(marker), 2)).toThrow('quadro-chave');
    expect(() => webmHeader(new Uint8Array([0]))).toThrow('incompleto');
  });
  it('handles finite-size clusters and discards an incomplete tail', () => {
    const bytes = cluster(5000); bytes[4] = 0x80 | (bytes.length - 5);
    const expected = [...bytes]; expected[7] = 0; expected[8] = 0;
    expect([...rebaseWebmClusters(new Uint8Array([...bytes, ...marker, 0xff, 0xe7]), 2)]).toEqual(expected);
  });
  it('recognizes Chromium BlockGroup keyframes and rejects reference-dependent blocks', () => {
    const group = [0xa0, 0x87, 0xa1, 0x85, 0x82, 0, 0, 0, 11];
    const bytes = [...marker, 0xff, 0xe7, 0x82, 0x13, 0x88, ...group];
    const expected = [...bytes]; expected[7] = 0; expected[8] = 0;
    expect([...rebaseWebmClusters(new Uint8Array(bytes), 2)]).toEqual(expected);
    const delta = [...bytes]; delta[10] = 0x8a; delta.push(0xfb, 0x81, 0xff);
    expect(() => rebaseWebmClusters(new Uint8Array(delta), 2)).toThrow('quadro-chave');
  });
});
describe('Native replay routing', () => {
  it('does not route a browser capture inside Tauri to Rust replay', () => {
    expect(nativeReplayContext('local-me', { session: { provider: 'browser', sessionId: 'browser_123' } })).toBeNull();
    const native = { uiAudioMode: 'system', session: { provider: 'native', sessionId: '123' } };
    expect(nativeReplayContext('local-me', native)).toEqual({ sessionId: '123' });
    expect(nativeReplayContext('alice', native)).toBeNull();
    expect(nativeReplayContext('local-me', { ...native, uiAudioMode: 'mic' })).toBeNull();
  });
});
