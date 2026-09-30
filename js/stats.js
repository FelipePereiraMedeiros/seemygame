import { createStatsMonitorScope } from './stats/monitor.js';
export { createStatsMonitorScope };
const legacyScope = createStatsMonitorScope();
export const { startStatsMonitor, stopStatsMonitor, getLastMetrics } = legacyScope;
