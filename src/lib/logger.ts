// Lightweight debug logger — system events only (connect, start, errors)
// EEG raw data stored separately in eegStore to avoid log flooding

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'success' | 'tx';

export interface LogEntry {
  ts: number;
  level: LogLevel;
  tag: string;
  msg: string;
}

// --- System Event Log (Debug Log) ---
const MAX_MEMORY = 500;

let entries: LogEntry[] = [];
let listeners: Set<(all: LogEntry[]) => void> = new Set();
let rafScheduled = false;

// Dedup: don't log the exact same message within 200ms
let lastDedupKey = '';
let lastDedupTs = 0;

function dedupKey(level: LogLevel, tag: string, msg: string): string {
  return `${level}:${tag}:${msg}`;
}

function scheduleFlush() {
  if (rafScheduled) return;
  rafScheduled = true;
  requestAnimationFrame(() => {
    rafScheduled = false;
    const allEntries = [...entries];
    listeners.forEach((cb) => { try { cb(allEntries); } catch {} });
  });
}

// --- EEG Data Store (separate from system log) ---
const EEG_MAX = 100;

export interface EEGLogEntry {
  ts: number;
  deviceId: string;
  deviceName: string;
  hex: string;
  bytes: number;
  packetNum?: number;
  channels?: string;
}

let eegEntries: EEGLogEntry[] = [];
let eegListeners: Set<(all: EEGLogEntry[]) => void> = new Set();

// --- Public API ---
export const logger = {
  // System events (go to Debug Log)
  push(level: LogLevel, tag: string, msg: string) {
    const key = dedupKey(level, tag, msg);
    const now = Date.now();
    if (key === lastDedupKey && now - lastDedupTs < 200) return;
    lastDedupKey = key;
    lastDedupTs = now;

    const e: LogEntry = { ts: now, level, tag, msg };
    entries.push(e);
    if (entries.length > MAX_MEMORY) entries = entries.slice(-MAX_MEMORY);
    scheduleFlush();
  },

  debug(tag: string, msg: string) { this.push('debug', tag, msg); },
  info(tag: string, msg: string) { this.push('info', tag, msg); },
  warn(tag: string, msg: string) { this.push('warn', tag, msg); },
  error(tag: string, msg: string) { this.push('error', tag, msg); },
  success(tag: string, msg: string) { this.push('success', tag, msg); },
  tx(tag: string, msg: string) { this.push('tx', tag, msg); },
  // rx() removed — EEG data goes to eegStore, not system log

  getEntries(): LogEntry[] { return entries; },

  subscribe(cb: (entries: LogEntry[]) => void): () => void {
    listeners.add(cb);
    Promise.resolve().then(() => { try { cb(entries); } catch {} });
    return () => { listeners.delete(cb); };
  },

  clear() {
    entries = []; lastDedupKey = '';
    listeners.forEach((cb) => { try { cb([]); } catch {} });
  },

  exportText(): string {
    if (entries.length === 0) return '// No log entries';
    return entries
      .map((e) => {
        const t = new Date(e.ts);
        const h = String(t.getHours()).padStart(2, '0');
        const m = String(t.getMinutes()).padStart(2, '0');
        const s = String(t.getSeconds()).padStart(2, '0');
        const ms = String(t.getMilliseconds()).padStart(3, '0');
        return `${h}:${m}:${s}.${ms} [${e.level.toUpperCase()}] [${e.tag}] ${e.msg}`;
      })
      .join('\n');
  },

  download() {
    const blob = new Blob([this.exportText()], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `neiry_debug_${Date.now()}.log`;
    a.click();
    URL.revokeObjectURL(url);
  },

  async copyToClipboard(): Promise<boolean> {
    try { await navigator.clipboard.writeText(this.exportText()); return true; } catch { return false; }
  },

  // --- EEG Data Store (separate) ---
  eegPush(entry: EEGLogEntry) {
    eegEntries.push(entry);
    if (eegEntries.length > EEG_MAX) eegEntries = eegEntries.slice(-EEG_MAX);
    // Synchronous flush — RAF loses data in BLE callbacks
    eegListeners.forEach((cb) => { try { cb([...eegEntries]); } catch {} });
    // Debug: mirror to console so we can verify it's being called
    console.log(`[EEG] ${entry.deviceName} ${entry.hex} (${entry.bytes}b)`);
  },

  eegGetEntries(): EEGLogEntry[] { return eegEntries; },

  eegSubscribe(cb: (entries: EEGLogEntry[]) => void): () => void {
    eegListeners.add(cb);
    Promise.resolve().then(() => { try { cb(eegEntries); } catch {} });
    return () => { eegListeners.delete(cb); };
  },

  eegClear() {
    eegEntries = [];
    eegListeners.forEach((cb) => { try { cb([]); } catch {} });
  },

  eegExportText(): string {
    if (eegEntries.length === 0) return '// No EEG data';
    return eegEntries
      .map((e) => {
        const t = new Date(e.ts);
        const h = String(t.getHours()).padStart(2, '0');
        const m = String(t.getMinutes()).padStart(2, '0');
        const s = String(t.getSeconds()).padStart(2, '0');
        const ms = String(t.getMilliseconds()).padStart(3, '0');
        return `${h}:${m}:${s}.${ms} [${e.deviceName}] ${e.hex} (${e.bytes}b)${e.packetNum !== undefined ? ` pkt=${e.packetNum}` : ''}${e.channels ? ` ch=${e.channels}` : ''}`;
      })
      .join('\n');
  },

  eegDownload() {
    const blob = new Blob([this.eegExportText()], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `neiry_eeg_raw_${Date.now()}.log`;
    a.click();
    URL.revokeObjectURL(url);
  },
};
