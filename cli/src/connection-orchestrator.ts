// Connection Orchestrator — automatic multi-device connection with diagnostics

import { DeviceManager } from './device-manager.js';
import { Logger } from './logger.js';
import { AppConfig } from './config.js';
import type { NeiryDevice } from './types.js';

function sleep(ms: number) { return new Promise<void>((r) => setTimeout(r, ms)); }

export interface ConnectionResult {
  deviceId: string;
  deviceName: string;
  connected: boolean;
  streaming: boolean;
  error?: string;
  errorCode?: string;
  attempts: number;
}

export interface OrchestratorReport {
  discovered: number;
  connected: number;
  streaming: number;
  failed: number;
  results: ConnectionResult[];
  strategy: string;
  durationMs: number;
  recommendations: string[];
}

export class ConnectionOrchestrator {
  private manager: DeviceManager;
  private logger: Logger;
  private config: AppConfig;

  constructor(manager: DeviceManager, logger: Logger, config: AppConfig) {
    this.manager = manager;
    this.logger = logger;
    this.config = config;
  }

  /**
   * Main entry: discover and connect all devices automatically
   */
  async runAuto(maxDevices?: number): Promise<OrchestratorReport> {
    const startTime = Date.now();
    const target = maxDevices ?? this.config.maxDevices;

    this.logger.section('Auto Connection');
    this.logger.info('connection', `=== Auto-connect up to ${target} devices ===`, { strategy: 'sequential', target });

    // Phase 1: Discovery
    const discovered = await this.manager.scanMultiple(target);
    if (discovered.length === 0) {
      this.logger.warn('discovery', 'No devices found');
      return this.buildReport(startTime, []);
    }

    // Phase 2: Sequential connection with delay
    const results: ConnectionResult[] = [];
    for (const device of discovered) {
      const result = await this.connectAndValidate(device);
      results.push(result);
      if (!result.connected && result.errorCode === '0x85') {
        this.logger.warn('connection', 'Connection limit hit, waiting before next device...');
        await sleep(5000);
      } else if (discovered.indexOf(device) < discovered.length - 1) {
        await sleep(this.config.interDeviceDelay);
      }
    }

    // Phase 3: Start streaming on all connected
    const connected = results.filter((r) => r.connected);
    this.logger.info('streaming', `Starting EEG on ${connected.length} connected device(s)`);
    for (const result of connected) {
      const ok = await this.manager.startSignal(result.deviceId);
      result.streaming = ok;
      if (ok) {
        this.logger.success('streaming', `${result.deviceName} streaming`, { deviceId: result.deviceId });
      } else {
        this.logger.error('streaming', `${result.deviceName} failed to start streaming`, undefined, 'START_FAILED');
      }
      await sleep(500); // Small delay between starts
    }

    return this.buildReport(startTime, results);
  }

  /**
   * Connect a single device with validation
   */
  async connectAndValidate(device: NeiryDevice): Promise<ConnectionResult> {
    const result: ConnectionResult = {
      deviceId: device.id,
      deviceName: device.name,
      connected: false,
      streaming: false,
      attempts: 0,
    };

    // Try connect with retries
    for (let attempt = 1; attempt <= this.config.connectMaxRetries; attempt++) {
      result.attempts = attempt;
      const ok = await this.manager.connect(device.id, attempt);
      if (ok) {
        result.connected = true;
        break;
      }
      if (device.state === 'error') {
        // Check if it's a connection limit error
        // The error code is logged by device-manager, we check state
        if (attempt < this.config.connectMaxRetries) {
          this.logger.warn('connection', `Retry ${attempt + 1}/${this.config.connectMaxRetries} for ${device.name} after delay`);
          await sleep(this.config.connectRetryDelay * attempt); // Exponential backoff
        }
      }
    }

    if (!result.connected) {
      result.error = 'Failed to connect after all retries';
      result.errorCode = device.state === 'error' ? 'CONN_FAILED' : 'UNKNOWN';
      this.logger.error('connection', `${device.name} failed after ${result.attempts} attempts`, { deviceId: device.id }, result.errorCode);
      return result;
    }

    // Validate protocol
    const validation = await this.manager.validateProtocol(device.id);
    const allCharsFound = Object.values(validation.characteristicsFound).every(Boolean);
    if (!allCharsFound) {
      this.logger.warn('validation', `${device.name} missing some characteristics`, { deviceId: device.id, validation });
    }

    return result;
  }

  /**
   * Reconnect a dropped device
   */
  async reconnect(deviceId: string): Promise<boolean> {
    const device = this.manager.getDevice(deviceId);
    if (!device) return false;

    this.logger.warn('connection', `Attempting reconnect for ${device.name}`, { deviceId });

    // Disconnect first to clean state
    await this.manager.disconnect(deviceId);
    await sleep(3000);

    // Reconnect
    const connected = await this.manager.connect(deviceId);
    if (!connected) return false;

    // Restart streaming
    const streaming = await this.manager.startSignal(deviceId);
    return streaming;
  }

  /**
   * Graceful shutdown of all devices
   */
  async shutdown(): Promise<void> {
    this.logger.info('shutdown', 'Shutting down all devices...');
    const devices = this.manager.getDevices();
    for (const device of devices) {
      if (device.isStreaming) {
        await this.manager.stopSignal(device.id);
      }
      if (device.state === 'connected') {
        await this.manager.disconnect(device.id);
      }
    }
    this.logger.success('shutdown', 'All devices shut down');
  }

  private buildReport(startTime: number, results: ConnectionResult[]): OrchestratorReport {
    const durationMs = Date.now() - startTime;
    const connected = results.filter((r) => r.connected).length;
    const streaming = results.filter((r) => r.streaming).length;
    const failed = results.filter((r) => !r.connected).length;

    const recommendations: string[] = [];

    if (failed > 0) {
      const limitErrors = results.filter((r) => r.errorCode === '0x85');
      if (limitErrors.length > 0) {
        recommendations.push('🔴 BLE connection limit reached. Try:');
        recommendations.push('   - Disconnect other BLE devices');
        recommendations.push('   - Restart Bluetooth adapter');
        recommendations.push('   - Reduce number of devices');
      }
      const otherErrors = results.filter((r) => r.errorCode && r.errorCode !== '0x85');
      if (otherErrors.length > 0) {
        recommendations.push('🟡 Some devices failed to connect. Try:');
        recommendations.push('   - Ensure devices are charged and in range');
        recommendations.push('   - Remove and re-pair in system settings');
      }
    }

    if (connected > 0 && streaming < connected) {
      recommendations.push('🟡 Some devices connected but not streaming. Try:');
      recommendations.push('   - Validate protocol manually');
      recommendations.push('   - Check device firmware');
    }

    if (connected === results.length && results.length > 0) {
      recommendations.push('🟢 All devices connected successfully');
    }

    const report: OrchestratorReport = {
      discovered: results.length,
      connected,
      streaming,
      failed,
      results,
      strategy: 'sequential',
      durationMs,
      recommendations,
    };

    this.logger.section('Connection Report');
    this.logger.info('report', `Discovered: ${report.discovered}, Connected: ${report.connected}, Streaming: ${report.streaming}, Failed: ${report.failed}`);
    for (const rec of recommendations) {
      this.logger.info('report', rec);
    }

    return report;
  }
}
