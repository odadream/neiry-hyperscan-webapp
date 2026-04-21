export interface NeiryDevice {
  id: string;
  name: string;
  address: string;
  rssi: number;
  deviceType: DeviceType;
  adapter?: string;
  bluetoothDevice?: any;
  gattServer?: any;
  characteristics: DeviceCharacteristics;
  state: ConnectionState;
  isStreaming: boolean;
  batteryLevel: number | null;
  connectedAt: number | null;
  // EEG data buffers
  eegBuffer: EEGPoint[];
  impedanceBuffer: ImpedancePoint[];
  // Stats
  stats: ConnectionStats;
  // Validation
  validationResult: ProtocolValidationResult | null;
  // Log
  log: LogEntry[];
  // Settings
  settings: DeviceSettings;
}

export type DeviceType = 'headband_legacy' | 'headband_pro' | 'headphone' | 'brainbit' | 'brainbit_flex' | 'unknown';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'disconnecting' | 'error';

export interface DeviceCharacteristics {
  serviceUUID: string;
  batteryUUID: string;
  writeUUID: string;
  notifyUUID: string;
  impedanceUUID: string | null;
}

export interface EEGPacket {
  timestamp: number;
  packetNum: number;
  marker: number;
  samples: Record<string, number>;     // channel -> uV
  rawSamples: Record<string, number>;  // channel -> raw signed24
}

export interface EEGPoint {
  timestamp: number;
  channel: string;
  value: number;  // uV
}

export interface ImpedancePoint {
  timestamp: number;
  channel: string;
  valueKohm: number;
}

export interface ConnectionStats {
  packetsReceived: number;
  packetsLost: number;
  packetLossPercent: number;
  bytesReceived: number;
  startTime: number | null;
  lastPacketTime: number | null;
  effectiveSampleRate: number;
}

export interface ProtocolValidationResult {
  serviceFound: boolean;
  serviceUUID: string;
  characteristicsFound: Record<string, boolean>;
  characteristicUUIDs: Record<string, string>;
  notifyWorking: boolean;
  writeWorking: boolean;
  batteryReadable: boolean;
}

export interface DeviceSettings {
  voltageRange: number;
  gain: number;
  counterSize: number;     // 2 or 4 bytes
  littleEndian: boolean;    // true for legacy
  channels: string[];
  needsSettingsPacket: boolean;
}

export interface LogEntry {
  timestamp: number;
  level: 'debug' | 'info' | 'warning' | 'error' | 'success';
  message: string;
}

export interface MaxConnectionTestResult {
  devicesAttempted: number;
  devicesConnected: number;
  maxReached: boolean;
  errors: string[];
  timestamp: number;
}
