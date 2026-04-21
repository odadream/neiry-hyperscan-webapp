// EEG Data Collector — stream EEG data to CSV files

import { createWriteStream, WriteStream, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import type { NeiryDevice, EEGPoint } from './types.js';
import { Logger } from './logger.js';
import { AppConfig } from './config.js';

interface DeviceWriter {
  deviceId: string;
  deviceName: string;
  stream: WriteStream;
  rowCount: number;
  fileIndex: number;
  path: string;
}

export class EEGCollector {
  private logger: Logger;
  private config: AppConfig;
  private writers = new Map<string, DeviceWriter>();
  private buffer = new Map<string, EEGPoint[]>();
  private flushTimer: NodeJS.Timeout | null = null;
  private sessionDir: string;
  private isRunning = false;

  constructor(logger: Logger, config: AppConfig, sessionDir?: string) {
    this.logger = logger;
    this.config = config;
    this.sessionDir = sessionDir || join(config.outputDir, `session_${Date.now()}`);
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    if (!existsSync(this.sessionDir)) {
      mkdirSync(this.sessionDir, { recursive: true });
    }

    this.logger.info('streaming', `EEG collector started. Output: ${this.sessionDir}`);

    // Periodic flush
    this.flushTimer = setInterval(() => {
      this.flushAll();
    }, this.config.csvFlushInterval);
  }

  stop(): void {
    this.isRunning = false;
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.flushAll();

    // Close all writers
    for (const writer of this.writers.values()) {
      writer.stream.end();
    }
    this.writers.clear();

    this.logger.info('streaming', 'EEG collector stopped');
  }

  /**
   * Add EEG data point for a device
   */
  addData(deviceId: string, deviceName: string, point: EEGPoint): void {
    if (!this.isRunning) return;

    let buf = this.buffer.get(deviceId);
    if (!buf) {
      buf = [];
      this.buffer.set(deviceId, buf);
    }
    buf.push(point);
  }

  /**
   * Add multiple points at once (from a packet)
   */
  addPoints(deviceId: string, deviceName: string, points: EEGPoint[]): void {
    if (!this.isRunning) return;

    let buf = this.buffer.get(deviceId);
    if (!buf) {
      buf = [];
      this.buffer.set(deviceId, buf);
    }
    buf.push(...points);
  }

  private flushAll(): void {
    for (const [deviceId, points] of this.buffer) {
      if (points.length === 0) continue;
      this.flushDevice(deviceId, points);
    }
    this.buffer.clear();
  }

  private flushDevice(deviceId: string, points: EEGPoint[]): void {
    let writer = this.writers.get(deviceId);

    // Rotate file if needed
    const needsRotation = writer && writer.rowCount >= this.config.csvMaxRows;
    if (needsRotation) {
      writer!.stream.end();
      this.writers.delete(deviceId);
      writer = undefined;
    }

    // Create new writer if needed
    if (!writer) {
      const existingWriter = this.writers.get(deviceId);
      const fileIndex = existingWriter ? existingWriter.fileIndex + 1 : 0;
      const fileName = fileIndex === 0
        ? `eeg_${deviceId.replace(/[^a-zA-Z0-9]/g, '_')}.csv`
        : `eeg_${deviceId.replace(/[^a-zA-Z0-9]/g, '_')}_${fileIndex}.csv`;
      const filePath = join(this.sessionDir, fileName);

      const stream = createWriteStream(filePath, { flags: 'a' });
      const isNew = !existsSync(filePath) || fileIndex > 0;

      if (isNew) {
        stream.write('timestamp,device_id,device_name,channel,value_uv\n');
      }

      writer = {
        deviceId,
        deviceName: points[0]?.channel ? '' : '',
        stream,
        rowCount: 0,
        fileIndex,
        path: filePath,
      };
      this.writers.set(deviceId, writer);
      this.logger.debug('streaming', `Created CSV: ${filePath}`, { deviceId });
    }

    // Write points
    const deviceName = this.writers.get(deviceId)?.deviceName || deviceId;
    for (const pt of points) {
      const line = `${pt.timestamp.toFixed(6)},${deviceId},${deviceName},${pt.channel},${pt.value.toFixed(4)}\n`;
      writer.stream.write(line);
      writer.rowCount++;
    }

    this.logger.debug('streaming', `Flushed ${points.length} points for ${deviceId}`, { deviceId, rowCount: writer.rowCount });
  }

  getSessionDir(): string {
    return this.sessionDir;
  }

  getStats(): { deviceId: string; rowCount: number; filePath: string }[] {
    return Array.from(this.writers.values()).map((w) => ({
      deviceId: w.deviceId,
      rowCount: w.rowCount,
      filePath: w.path,
    }));
  }
}
