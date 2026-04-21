// EEG Packet Parser
// Implements the Neiry/BrainBit BLE protocol data format

import type { EEGPacket, DeviceSettings, ConnectionStats, ImpedancePoint, ProtocolValidationResult } from '@/types/bluetooth';
import { EEG_PARAMS, VOLTAGE_REF } from './protocol';

export function parseEEGData(
  data: DataView,
  settings: DeviceSettings,
  stats: ConnectionStats
): EEGPacket | null {
  const now = performance.now() / 1000;
  const counterSize = settings.counterSize;
  const totalLen = data.byteLength;

  if (totalLen < counterSize + 1) return null;

  let offset = 0;

  // Read counter
  let rawCounter: number;
  if (counterSize === 4) {
    rawCounter = data.getUint32(0, false); // big-endian for pro
    offset = 4;
  } else {
    rawCounter = data.getUint16(0, true); // little-endian for legacy
    offset = 2;
  }

  const counter = rawCounter >> EEG_PARAMS.COUNTER_SHIFT;

  // Update stats
  stats.packetsReceived++;
  stats.bytesReceived += totalLen;
  if (!stats.startTime) stats.startTime = now;

  // Packet loss detection
  if (stats.lastPacketTime && stats.packetsReceived > 1) {
    // simplified: compare timestamps instead of counter
    const expectedInterval = EEG_PARAMS.NUM_CHANNELS / EEG_PARAMS.SAMPLE_RATE;
    const actualInterval = now - stats.lastPacketTime;
    if (actualInterval > expectedInterval * 3) {
      stats.packetsLost++;
    }
  }
  stats.lastPacketTime = now;
  stats.packetLossPercent = stats.packetsReceived > 0
    ? (stats.packetsLost / (stats.packetsReceived + stats.packetsLost)) * 100
    : 0;

  // Calculate effective sample rate
  if (stats.startTime) {
    const duration = now - stats.startTime;
    if (duration > 0) {
      stats.effectiveSampleRate = stats.packetsReceived * EEG_PARAMS.NUM_CHANNELS / duration;
    }
  }

  // Parse EEG frames: [0x00 marker] + [3 bytes * 4 channels]
  const packet: EEGPacket = {
    timestamp: now,
    packetNum: counter,
    marker: 0,
    samples: {},
    rawSamples: {},
  };

  const channels = settings.channels;
  const frameSize = 1 + EEG_PARAMS.NUM_CHANNELS * EEG_PARAMS.BYTES_PER_SAMPLE;

  while (offset + frameSize <= totalLen) {
    const marker = data.getUint8(offset);
    offset++;

    if (marker !== EEG_PARAMS.FRAME_MARKER) {
      continue;
    }

    packet.marker = marker;

    for (let i = 0; i < channels.length && i < EEG_PARAMS.NUM_CHANNELS; i++) {
      if (offset + EEG_PARAMS.BYTES_PER_SAMPLE > totalLen) break;

      const raw = readSigned24(data, offset, settings.littleEndian);
      offset += EEG_PARAMS.BYTES_PER_SAMPLE;

      const uv = scaleToUV(raw, settings);
      packet.samples[channels[i]] = uv;
      packet.rawSamples[channels[i]] = raw;
    }
  }

  return Object.keys(packet.samples).length > 0 ? packet : null;
}

function readSigned24(data: DataView, offset: number, littleEndian: boolean): number {
  let raw: number;
  if (littleEndian) {
    raw = data.getUint8(offset) | (data.getUint8(offset + 1) << 8) | (data.getUint8(offset + 2) << 16);
  } else {
    raw = (data.getUint8(offset) << 16) | (data.getUint8(offset + 1) << 8) | data.getUint8(offset + 2);
  }
  // Sign extend from 24 to 32 bits
  if (raw & 0x800000) {
    raw |= ~0xFFFFFF;
  }
  // Convert to signed
  if (raw > 0x7FFFFF) {
    raw -= 0x1000000;
  }
  return raw;
}

function scaleToUV(rawValue: number, settings: DeviceSettings): number {
  const { voltageRange, gain } = settings;
  return rawValue * (voltageRange / VOLTAGE_REF) * (1e6 / gain);
}

export function parseImpedanceData(data: DataView, settings: DeviceSettings): ImpedancePoint[] | null {
  const now = performance.now() / 1000;
  const counterSize = settings.counterSize;

  if (data.byteLength < counterSize + 4) return null;

  let offset = counterSize; // skip counter
  const channels = settings.channels;
  const results: ImpedancePoint[] = [];

  for (let i = 0; i < channels.length; i++) {
    if (offset + 4 > data.byteLength) break;
    const raw = data.getInt32(offset, true); // little-endian
    offset += 4;
    results.push({
      timestamp: now,
      channel: channels[i],
      valueKohm: raw / 1000.0,
    });
  }

  return results;
}

export function parseBatteryData(data: DataView): number {
  return data.getUint8(0);
}

export function createEmptyStats(): ConnectionStats {
  return {
    packetsReceived: 0,
    packetsLost: 0,
    packetLossPercent: 0,
    bytesReceived: 0,
    startTime: null,
    lastPacketTime: null,
    effectiveSampleRate: 0,
  };
}

export function createEmptyValidation(): ProtocolValidationResult {
  return {
    serviceFound: false,
    serviceUUID: '',
    characteristicsFound: {},
    characteristicUUIDs: {},
    notifyWorking: false,
    writeWorking: false,
    batteryReadable: false,
  };
}
