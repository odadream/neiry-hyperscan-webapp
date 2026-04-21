// Structured logger for AI-agent analysis
// Outputs: colored console + JSON log file + markdown report

import { writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'success' | 'tx' | 'rx';
export type LogPhase = 'init' | 'discovery' | 'connection' | 'validation' | 'streaming' | 'diagnostics' | 'shutdown' | 'report' | 'profile' | 'sdk';

export interface LogEntry {
  ts: string;           // ISO 8601
  level: LogLevel;
  phase: LogPhase;
  deviceId?: string;
  deviceName?: string;
  action?: string;
  result?: 'success' | 'failure' | 'pending';
  errorCode?: string;
  context?: Record<string, unknown>;
  message: string;
}

// Console colors
const COLORS: Record<LogLevel, string> = {
  debug: '\x1b[90m',    // gray
  info: '\x1b[36m',     // cyan
  warn: '\x1b[33m',     // yellow
  error: '\x1b[31m',    // red
  success: '\x1b[32m',  // green
  tx: '\x1b[35m',       // magenta
  rx: '\x1b[34m',       // blue
};
const RESET = '\x1b[0m';
const PHASE_EMOJI: Record<LogPhase, string> = {
  init: '🔧',
  discovery: '🔍',
  connection: '🔗',
  validation: '✅',
  streaming: '📡',
  diagnostics: '🩺',
  shutdown: '🛑',
  report: '📊',
  profile: '🔬',
  sdk: '📦',
};

export interface LoggerOptions {
  logDir: string;
  consoleLevel: LogLevel;
  fileLevel: LogLevel;
  enableJson: boolean;
  enableMarkdown: boolean;
}

const DEFAULT_OPTIONS: LoggerOptions = {
  logDir: './logs',
  consoleLevel: 'info',
  fileLevel: 'debug',
  enableJson: true,
  enableMarkdown: true,
};

export class Logger {
  private opts: LoggerOptions;
  private jsonPath: string;
  private mdPath: string;
  private entries: LogEntry[] = [];
  private startTime: number;

  constructor(opts: Partial<LoggerOptions> = {}) {
    this.opts = { ...DEFAULT_OPTIONS, ...opts };
    this.startTime = Date.now();

    // Ensure log directory exists
    if (!existsSync(this.opts.logDir)) {
      mkdirSync(this.opts.logDir, { recursive: true });
    }

    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    this.jsonPath = join(this.opts.logDir, `session_${ts}.jsonl`);
    this.mdPath = join(this.opts.logDir, `session_${ts}.md`);

    if (this.opts.enableMarkdown) {
      writeFileSync(this.mdPath, `# Neiry CLI Session Report\n\n**Started:** ${new Date().toISOString()}\n\n---\n\n`);
    }

    this.log('init', 'Logger initialized', 'info', { logDir: this.opts.logDir, jsonPath: this.jsonPath });
  }

  log(
    phase: LogPhase,
    message: string,
    level: LogLevel = 'info',
    context?: Record<string, unknown>,
    deviceId?: string,
    deviceName?: string,
    action?: string,
    result?: LogEntry['result'],
    errorCode?: string
  ): void {
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      phase,
      message,
      ...(deviceId && { deviceId }),
      ...(deviceName && { deviceName }),
      ...(action && { action }),
      ...(result && { result }),
      ...(errorCode && { errorCode }),
      ...(context && { context }),
    };

    this.entries.push(entry);

    // Console output
    if (this.levelRank(level) >= this.levelRank(this.opts.consoleLevel)) {
      this.printConsole(entry);
    }

    // JSON file output
    if (this.opts.enableJson && this.levelRank(level) >= this.levelRank(this.opts.fileLevel)) {
      appendFileSync(this.jsonPath, JSON.stringify(entry) + '\n');
    }
  }

  // Convenience methods
  debug(phase: LogPhase, message: string, context?: Record<string, unknown>) {
    this.log(phase, message, 'debug', context);
  }
  info(phase: LogPhase, message: string, context?: Record<string, unknown>) {
    this.log(phase, message, 'info', context);
  }
  warn(phase: LogPhase, message: string, context?: Record<string, unknown>, errorCode?: string) {
    this.log(phase, message, 'warn', context, undefined, undefined, undefined, undefined, errorCode);
  }
  error(phase: LogPhase, message: string, context?: Record<string, unknown>, errorCode?: string) {
    this.log(phase, message, 'error', context, undefined, undefined, undefined, undefined, errorCode);
  }
  success(phase: LogPhase, message: string, context?: Record<string, unknown>) {
    this.log(phase, message, 'success', context);
  }
  tx(phase: LogPhase, message: string, context?: Record<string, unknown>) {
    this.log(phase, message, 'tx', context);
  }
  rx(phase: LogPhase, message: string, context?: Record<string, unknown>) {
    this.log(phase, message, 'rx', context);
  }

  // Device-specific logging
  deviceLog(
    phase: LogPhase,
    deviceId: string,
    deviceName: string,
    action: string,
    result: LogEntry['result'],
    message: string,
    level: LogLevel = 'info',
    errorCode?: string,
    context?: Record<string, unknown>
  ) {
    this.log(phase, message, level, context, deviceId, deviceName, action, result, errorCode);
  }

  // Print to console with colors
  private printConsole(entry: LogEntry): void {
    const color = COLORS[entry.level] || '';
    const emoji = PHASE_EMOJI[entry.phase] || '';
    const ts = entry.ts.split('T')[1]?.split('.')[0] || '';
    const deviceTag = entry.deviceName ? ` [${entry.deviceName}]` : '';
    const resultTag = entry.result ? ` (${entry.result})` : '';
    const errTag = entry.errorCode ? ` [${entry.errorCode}]` : '';

    const line = `${color}[${ts}] ${emoji} [${entry.phase.toUpperCase()}]${deviceTag}${resultTag}${errTag} ${entry.message}${RESET}`;
    console.log(line);
  }

  // Markdown report section
  section(title: string): void {
    if (!this.opts.enableMarkdown) return;
    appendFileSync(this.mdPath, `\n## ${title}\n\n`);
  }

  md(text: string): void {
    if (!this.opts.enableMarkdown) return;
    appendFileSync(this.mdPath, text + '\n');
  }

  // Summary statistics
  getSummary() {
    const byPhase = new Map<LogPhase, number>();
    const byLevel = new Map<LogLevel, number>();
    const errors = this.entries.filter(e => e.level === 'error');
    const deviceEvents = this.entries.filter(e => e.deviceId);

    for (const e of this.entries) {
      byPhase.set(e.phase, (byPhase.get(e.phase) || 0) + 1);
      byLevel.set(e.level, (byLevel.get(e.level) || 0) + 1);
    }

    return {
      totalEntries: this.entries.length,
      durationMs: Date.now() - this.startTime,
      byPhase: Object.fromEntries(byPhase),
      byLevel: Object.fromEntries(byLevel),
      errorCount: errors.length,
      errors: errors.map(e => ({ ts: e.ts, message: e.message, errorCode: e.errorCode, deviceName: e.deviceName })),
      deviceEventCount: deviceEvents.length,
    };
  }

  // Finalize and write report
  finalize(): void {
    const summary = this.getSummary();
    this.info('report', 'Session finalized', summary);

    if (this.opts.enableMarkdown) {
      appendFileSync(this.mdPath, `\n---\n\n## Summary\n\n`);
      appendFileSync(this.mdPath, `- **Total log entries:** ${summary.totalEntries}\n`);
      appendFileSync(this.mdPath, `- **Duration:** ${(summary.durationMs / 1000).toFixed(1)}s\n`);
      appendFileSync(this.mdPath, `- **Errors:** ${summary.errorCount}\n`);
      appendFileSync(this.mdPath, `\n### By Phase\n\n`);
      for (const [phase, count] of Object.entries(summary.byPhase)) {
        appendFileSync(this.mdPath, `- ${PHASE_EMOJI[phase as LogPhase]} ${phase}: ${count}\n`);
      }
      if (summary.errors.length > 0) {
        appendFileSync(this.mdPath, `\n### Errors\n\n`);
        for (const err of summary.errors) {
          appendFileSync(this.mdPath, `- **${err.ts}**${err.deviceName ? ` [${err.deviceName}]` : ''}: ${err.message}${err.errorCode ? ` (code: ${err.errorCode})` : ''}\n`);
        }
      }
      appendFileSync(this.mdPath, `\n**Finished:** ${new Date().toISOString()}\n`);
    }

    console.log(`\n${COLORS.success}📁 Logs saved to:${RESET}`);
    console.log(`   JSON: ${this.jsonPath}`);
    if (this.opts.enableMarkdown) console.log(`   Report: ${this.mdPath}`);
  }

  private levelRank(level: LogLevel): number {
    const ranks: Record<LogLevel, number> = {
      debug: 0, info: 1, success: 1, warn: 2, error: 3, tx: 0, rx: 0,
    };
    return ranks[level] ?? 0;
  }
}

// Global logger instance
let globalLogger: Logger | null = null;

export function getLogger(opts?: Partial<LoggerOptions>): Logger {
  if (!globalLogger) {
    globalLogger = new Logger(opts);
  }
  return globalLogger;
}

export function resetLogger(): void {
  globalLogger = null;
}
