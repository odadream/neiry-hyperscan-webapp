// Neiry/BrainBit BLE Protocol Constants
// Based on reverse-engineered protocol + SDK2 docs

export const GATT_SERVICE_HEADBAND = '7e400001-b534-f393-68a9-e50e24dcca95';
export const GATT_SERVICE_HEADPHONE = '7e400001-b534-f393-68a9-e50e24dcca96';

export const COMMANDS = {
  POWER_DOWN: 0x01,
  GO_IDLE: 0x02,
  START_SIGNAL: 0x03,
  START_RESIST: 0x04,
} as const;

export const SETTINGS_PACKET = new Uint8Array([
  0x08, 0x01, 0x03, 0x01, 0x03, 0x01, 0x03, 0x01,
  0x03, 0x01, 0x01, 0x01, 0x01, 0x01
]);

export const TIMING = {
  POWERDOWN_TO_IDLE: 1200,
  IDLE_TO_SETTINGS: 50,
  SETTINGS_TO_START: 50,
} as const;

export const EEG_PARAMS = {
  SAMPLE_RATE: 250,
  NUM_CHANNELS: 4,
  FRAME_MARKER: 0x00,
  BYTES_PER_SAMPLE: 3,
  COUNTER_SHIFT: 3,
  MAX_PACK_NUM: 2047,
} as const;

export const CHANNELS_HEADBAND = ['O1', 'T3', 'T4', 'O2'];
export const CHANNELS_HEADPHONE = ['A1', 'T5', 'T6', 'A2'];

export const VOLTAGE_REF = (1 << 23) - 1; // 8388607

// Correct UUID template: 7e40000{X}-b534-f393-68a9-e50e24dcca9{Y}
// X = 1 service, 2 battery, 3 write, 4 notify, 5 impedance
// Y = 5 headband, 6 headphone
const UUID_TEMPLATE = '7e40000{prefix}-b534-f393-68a9-e50e24dcca9{suffix}';

export function getServiceUUID(deviceName: string): string {
  return deviceName.includes('Headphone') ? GATT_SERVICE_HEADPHONE : GATT_SERVICE_HEADBAND;
}

export function getCharacteristicUUIDs(deviceName: string) {
  const suffix = deviceName.includes('Headphone') ? '6' : '5';

  const makeUUID = (prefix: string) =>
    UUID_TEMPLATE.replace('{prefix}', prefix).replace('{suffix}', suffix);

  return {
    service: makeUUID('1'),
    battery: makeUUID('2'),
    write: makeUUID('3'),
    notify: makeUUID('4'),
    ...(deviceName.includes('Headphone') ? { impedance: makeUUID('5') } : {}),
  };
}

export function detectDeviceType(name: string): import('./types.js').DeviceType {
  const n = name.toLowerCase();
  if (n.includes('headphone')) return 'headphone';
  if (n.includes('flex')) return 'brainbit_flex';
  if (n.includes('brainbit')) return 'brainbit';
  if (n.includes('headband')) return 'headband_pro';
  return 'unknown';
}

export function getChannels(deviceType: import('./types.js').DeviceType): string[] {
  return deviceType === 'headphone' ? CHANNELS_HEADPHONE : CHANNELS_HEADBAND;
}

export function getScalingParams(deviceType: import('./types.js').DeviceType) {
  switch (deviceType) {
    case 'headphone': return { voltageRange: 4.5, gain: 6 };
    default: return { voltageRange: 2.4, gain: 6 };
  }
}

export function getDeviceSettings(deviceType: import('./types.js').DeviceType): import('./types.js').DeviceSettings {
  const channels = getChannels(deviceType);
  const { voltageRange, gain } = getScalingParams(deviceType);
  const isLegacy = deviceType === 'headband_legacy';

  return {
    voltageRange, gain,
    counterSize: isLegacy ? 2 : 4,
    littleEndian: isLegacy,
    channels,
    needsSettingsPacket: deviceType === 'headband_pro' || deviceType === 'headphone' || deviceType === 'brainbit_flex',
  };
}

export function makeStartupSequence(settings: import('./types.js').DeviceSettings): { cmd: Uint8Array; delay: number }[] {
  const seq: { cmd: Uint8Array; delay: number }[] = [];
  seq.push({ cmd: new Uint8Array([COMMANDS.POWER_DOWN]), delay: TIMING.POWERDOWN_TO_IDLE });
  seq.push({ cmd: new Uint8Array([COMMANDS.GO_IDLE]), delay: TIMING.IDLE_TO_SETTINGS });
  if (settings.needsSettingsPacket) {
    seq.push({ cmd: SETTINGS_PACKET, delay: TIMING.SETTINGS_TO_START });
  }
  seq.push({ cmd: new Uint8Array([COMMANDS.START_SIGNAL]), delay: 0 });
  return seq;
}

export function makeStopSequence(): { cmd: Uint8Array; delay: number }[] {
  return [{ cmd: new Uint8Array([COMMANDS.GO_IDLE]), delay: TIMING.IDLE_TO_SETTINGS }];
}

export function makeImpedanceSequence(settings: import('./types.js').DeviceSettings): { cmd: Uint8Array; delay: number }[] {
  const seq: { cmd: Uint8Array; delay: number }[] = [];
  seq.push({ cmd: new Uint8Array([COMMANDS.POWER_DOWN]), delay: TIMING.POWERDOWN_TO_IDLE });
  seq.push({ cmd: new Uint8Array([COMMANDS.GO_IDLE]), delay: TIMING.IDLE_TO_SETTINGS });
  if (settings.needsSettingsPacket) {
    seq.push({ cmd: SETTINGS_PACKET, delay: TIMING.SETTINGS_TO_START });
  }
  seq.push({ cmd: new Uint8Array([COMMANDS.START_RESIST]), delay: 0 });
  return seq;
}
