// Connection History Tracker
// Logs every connection attempt, success, failure, and stream session to JSONL
// For device behavior analysis and health trend tracking

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';

export interface ConnectionEvent {
  ts: string;           // ISO 8601
  event: 'scan' | 'connect_attempt' | 'connect_success' | 'connect_fail' |
         'disconnect' | 'stream_start' | 'stream_stop' | 'stream_data' |
         'error' | 'profile';
  deviceId: string;
  deviceName?: string;
  deviceSerial?: string;  // from SDK if known
  bleMac?: string;
  durationMs?: number;
  errorCode?: string;
  errorMsg?: string;
  servicesCount?: number;
  hasNeiryService?: boolean;
  batteryLevel?: number;
  samplesReceived?: number;
  streamDurationMs?: number;
  mode?: number;  // device mode after start
  notes?: string;
}

export interface DeviceHistorySummary {
  deviceId: string;
  deviceName: string;
  totalConnections: number;
  successfulConnections: number;
  failedConnections: number;
  totalStreamSessions: number;
  totalSamplesReceived: number;
  lastSeen: string;
  lastBatteryLevel?: number;
  averageConnectTimeMs: number;
  failurePatterns: { code: string; count: number }[];
  healthTrend: 'improving' | 'stable' | 'degrading' | 'unknown';
}

export class ConnectionHistory {
  private logPath: string;
  private events: ConnectionEvent[] = [];

  constructor(logDir: string) {
    this.logPath = join(logDir, 'connection_history.jsonl');
    this.load();
  }

  private load() {
    if (!existsSync(this.logPath)) return;
    try {
      const lines = readFileSync(this.logPath, 'utf-8').split('\n').filter(Boolean);
      for (const line of lines) {
        try { this.events.push(JSON.parse(line)); } catch { /* skip bad line */ }
      }
    } catch { /* ignore */ }
  }

  private write(event: ConnectionEvent) {
    this.events.push(event);
    try {
      appendFileSync(this.logPath, JSON.stringify(event) + '\n');
    } catch { /* ignore */ }
  }

  // --- Public API ---

  logScan(deviceId: string, deviceName: string, bleMac?: string, notes?: string) {
    this.write({ ts: new Date().toISOString(), event: 'scan', deviceId, deviceName, bleMac, notes });
  }

  logConnectAttempt(deviceId: string, deviceName: string, attempt: number, maxAttempts: number) {
    this.write({
      ts: new Date().toISOString(), event: 'connect_attempt', deviceId, deviceName,
      notes: `attempt ${attempt}/${maxAttempts}`,
    });
  }

  logConnectSuccess(deviceId: string, deviceName: string, durationMs: number, servicesCount?: number, hasNeiryService?: boolean, batteryLevel?: number) {
    this.write({
      ts: new Date().toISOString(), event: 'connect_success', deviceId, deviceName,
      durationMs, servicesCount, hasNeiryService, batteryLevel,
    });
  }

  logConnectFail(deviceId: string, deviceName: string, errorCode: string, errorMsg: string, durationMs?: number) {
    this.write({
      ts: new Date().toISOString(), event: 'connect_fail', deviceId, deviceName,
      errorCode, errorMsg, durationMs,
    });
  }

  logDisconnect(deviceId: string, deviceName: string, notes?: string) {
    this.write({ ts: new Date().toISOString(), event: 'disconnect', deviceId, deviceName, notes });
  }

  logStreamStart(deviceId: string, deviceName: string, mode?: number) {
    this.write({ ts: new Date().toISOString(), event: 'stream_start', deviceId, deviceName, mode });
  }

  logStreamStop(deviceId: string, deviceName: string, samplesReceived: number, streamDurationMs: number) {
    this.write({
      ts: new Date().toISOString(), event: 'stream_stop', deviceId, deviceName,
      samplesReceived, streamDurationMs,
    });
  }

  logStreamData(deviceId: string, deviceName: string, samplesReceived: number, notes?: string) {
    this.write({
      ts: new Date().toISOString(), event: 'stream_data', deviceId, deviceName,
      samplesReceived, notes,
    });
  }

  logError(deviceId: string, deviceName: string, errorCode: string, errorMsg: string) {
    this.write({
      ts: new Date().toISOString(), event: 'error', deviceId, deviceName,
      errorCode, errorMsg,
    });
  }

  logProfile(deviceId: string, deviceName: string, servicesCount: number, hasNeiryService: boolean, batteryLevel?: number, notes?: string) {
    this.write({
      ts: new Date().toISOString(), event: 'profile', deviceId, deviceName,
      servicesCount, hasNeiryService, batteryLevel, notes,
    });
  }

  // --- Analysis ---

  getDeviceSummary(deviceId: string): DeviceHistorySummary | undefined {
    const evs = this.events.filter(e => e.deviceId === deviceId);
    if (evs.length === 0) return undefined;

    const connects = evs.filter(e => e.event === 'connect_success');
    const fails = evs.filter(e => e.event === 'connect_fail');
    const streams = evs.filter(e => e.event === 'stream_stop');

    const failCodes = new Map<string, number>();
    for (const f of fails) {
      if (f.errorCode) failCodes.set(f.errorCode, (failCodes.get(f.errorCode) || 0) + 1);
    }

    const avgConnect = connects.length > 0
      ? connects.reduce((s, e) => s + (e.durationMs || 0), 0) / connects.length
      : 0;

    const totalSamples = streams.reduce((s, e) => s + (e.samplesReceived || 0), 0);

    // Health trend: compare last 3 sessions vs previous 3
    const allConnects = evs.filter(e => e.event === 'connect_success' || e.event === 'connect_fail');
    let trend: DeviceHistorySummary['healthTrend'] = 'unknown';
    if (allConnects.length >= 6) {
      const recent = allConnects.slice(-3).filter(e => e.event === 'connect_success').length;
      const previous = allConnects.slice(-6, -3).filter(e => e.event === 'connect_success').length;
      if (recent > previous) trend = 'improving';
      else if (recent < previous) trend = 'degrading';
      else trend = 'stable';
    }

    const lastBattery = [...evs].reverse().find(e => e.batteryLevel !== undefined)?.batteryLevel;

    return {
      deviceId,
      deviceName: evs[0].deviceName || deviceId,
      totalConnections: allConnects.length,
      successfulConnections: connects.length,
      failedConnections: fails.length,
      totalStreamSessions: streams.length,
      totalSamplesReceived: totalSamples,
      lastSeen: evs[evs.length - 1].ts,
      lastBatteryLevel: lastBattery,
      averageConnectTimeMs: Math.round(avgConnect),
      failurePatterns: Array.from(failCodes.entries()).map(([code, count]) => ({ code, count })),
      healthTrend: trend,
    };
  }

  getAllSummaries(): DeviceHistorySummary[] {
    const ids = new Set(this.events.map(e => e.deviceId));
    return Array.from(ids)
      .map(id => this.getDeviceSummary(id))
      .filter((s): s is DeviceHistorySummary => s !== undefined)
      .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
  }

  getRecentEvents(deviceId: string, limit = 20): ConnectionEvent[] {
    return this.events
      .filter(e => e.deviceId === deviceId)
      .slice(-limit);
  }

  getEventsForTimeRange(start: string, end: string): ConnectionEvent[] {
    return this.events.filter(e => e.ts >= start && e.ts <= end);
  }
}
