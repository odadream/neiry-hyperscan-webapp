// Configuration for Neiry CLI

export interface AppConfig {
  // Discovery
  scanTime: number;           // seconds to scan for devices
  maxDevices: number;         // maximum devices to connect
  namePrefixes: string[];     // device name prefixes to match

  // Connection
  connectTimeout: number;     // ms to wait for connect
  connectRetryDelay: number;  // ms between retry attempts
  connectMaxRetries: number;  // max retry attempts per device
  interDeviceDelay: number;   // ms between connecting devices

  // Streaming
  startupSequenceDelay: number;  // ms after startup sequence before streaming
  watchdogInterval: number;   // ms between watchdog checks
  watchdogTimeout: number;    // ms without packets before reconnect

  // Data collection
  csvFlushInterval: number;   // ms between CSV flushes
  csvMaxRows: number;         // max rows per CSV file
  outputDir: string;          // output directory for data

  // Logging
  logDir: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  enableJson: boolean;
  enableMarkdown: boolean;
}

export const DEFAULT_CONFIG: AppConfig = {
  scanTime: 15,
  maxDevices: 4,
  namePrefixes: ['Headband', 'Headphone', 'BrainBit'],

  connectTimeout: 10000,
  connectRetryDelay: 2000,
  connectMaxRetries: 3,
  interDeviceDelay: 2500,

  startupSequenceDelay: 1500,
  watchdogInterval: 5000,
  watchdogTimeout: 10000,

  csvFlushInterval: 5000,
  csvMaxRows: 50000,
  outputDir: './data',

  logDir: './logs',
  logLevel: 'info',
  enableJson: true,
  enableMarkdown: true,
};

export function mergeConfig(partial: Partial<AppConfig>): AppConfig {
  return { ...DEFAULT_CONFIG, ...partial };
}
