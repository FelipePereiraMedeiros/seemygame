import { collectPeerMetrics } from './metrics.js';
import { renderStatsHud } from './hud.js';
/** One telemetry scope per session. Stopped async samples cannot revive a monitor. */
export function createStatsMonitorScope() {
 const monitors = new Map(), metrics = new Map();
 function stopStatsMonitor(id) { const entry = monitors.get(id); if (entry) clearInterval(entry.timer); monitors.delete(id); metrics.delete(id); }
 function startStatsMonitor(id, pc, isLocal = false, onTelemetry = null) {
  stopStatsMonitor(id);
  const entry = { timer: null, timestamp: performance.now(), bytes: 0 }; monitors.set(id, entry); metrics.set(id, {});
  entry.timer = setInterval(async () => {
   if (!pc || pc.connectionState === 'closed') { stopStatsMonitor(id); return; }
   try {
    const reports = await pc.getStats(); if (monitors.get(id) !== entry) return;
    const now = performance.now();
    const sample = collectPeerMetrics(reports, { peerId: id, isLocal, previous: metrics.get(id), lastBytes: entry.bytes, lastTimestamp: entry.timestamp, now });
    entry.bytes = sample.bytes; entry.timestamp = now; metrics.set(id, sample);
    renderStatsHud(id, isLocal, sample); onTelemetry?.(sample);
   } catch (_) {}
  }, 1000);
 }
 function getLastMetrics(id = null) { return id ? metrics.get(id) || null : Object.fromEntries(metrics); }
 return { startStatsMonitor, stopStatsMonitor, getLastMetrics, dispose: () => [...monitors.keys()].forEach(stopStatsMonitor) };
}
