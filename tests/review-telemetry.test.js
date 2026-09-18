import { afterEach, expect, it, vi } from 'vitest';
import { startStatsMonitor, stopStatsMonitor } from '../js/stats.js';
afterEach(() => { stopStatsMonitor('review-metrics'); vi.clearAllTimers(); vi.useRealTimers(); });
it('L12: telemetria informa custo de encoding por intervalo, não só FPS/RTT', async () => {
  vi.useFakeTimers(); let n = 0; const samples = [];
  const pc = { connectionState: 'connected', getStats: async () => new Map([['v', { id: 'v', type: 'outbound-rtp', kind: 'video', bytesSent: ++n * 1000, framesEncoded: n * 60, totalEncodeTime: n * 0.12, totalPacketSendDelay: n * 0.06, packetsSent: n * 100 }]]) };
  startStatsMonitor('review-metrics', pc, true, s => samples.push(s));
  await vi.advanceTimersByTimeAsync(2000);
  expect(samples.at(-1).encodeTimeMs).toBeCloseTo(2);
});
