// Test the second device in isolation
// This script skips the first device and connects to the second one found

import { Bluetooth } from 'webbluetooth';
import { Logger } from './logger.js';
import { DeviceManager } from './device-manager.js';
import { DeviceProfiler } from './device-profiler.js';
import { mergeConfig } from './config.js';

async function main() {
  const cfg = mergeConfig({});
  const logger = new Logger({
    logDir: './logs',
    consoleLevel: 'debug',
    fileLevel: 'debug',
    enableJson: true,
    enableMarkdown: true,
  });

  logger.info('init', '=== Testing SECOND device in isolation ===');

  // Custom scan: collect all devices, skip first, connect second
  const services = [
    '7e400001-b534-f393-68a9-e50e24dcca95',
    '7e400001-b534-f393-68a9-e50e24dcca96',
    '00001800-0000-1000-8000-00805f9b34fb',
    '00001801-0000-1000-8000-00805f9b34fb',
    '0000180f-0000-1000-8000-00805f9b34fb',
  ];
  const filters = [{ namePrefix: 'Headband' }, { namePrefix: 'Headphone' }, { namePrefix: 'BrainBit' }];

  const foundDevices: { name: string; id: string; btDevice: any }[] = [];

  // Scan for multiple devices
  for (let i = 0; i < 3; i++) {
    try {
      const bt = new Bluetooth({
        deviceFound: (device) => {
          const name = device.name || '';
          const match = name.startsWith('Headband') || name.startsWith('Headphone') || name.startsWith('BrainBit');
          if (!match) return false;
          if (foundDevices.some((d) => d.id === device.id)) return false;
          foundDevices.push({ name, id: device.id, btDevice: device });
          logger.info('discovery', `Found device ${foundDevices.length}: "${name}" id=${device.id}`);
          return true;
        },
        scanTime: 10,
      });

      const device = await bt.requestDevice({ filters, optionalServices: services });
      if (!device) break;
    } catch (e) {
      logger.info('discovery', `Scan ended: ${e instanceof Error ? e.message : String(e)}`);
      break;
    }
  }

  logger.info('discovery', `Total devices found: ${foundDevices.length}`);

  if (foundDevices.length < 2) {
    logger.error('discovery', 'Need at least 2 devices to test second one');
    logger.finalize();
    process.exit(1);
  }

  // Test the SECOND device
  const target = foundDevices[1];
  logger.info('init', `Testing device: ${target.name} (${target.id})`);

  const manager = new DeviceManager(logger, cfg);
  const profiler = new DeviceProfiler(logger);

  // Add device to manager manually
  const deviceType = target.name.includes('Headphone') ? 'headphone' : 'headband_pro';
  const { getCharacteristicUUIDs, getDeviceSettings } = await import('./protocol.js');
  const charUUIDs = getCharacteristicUUIDs(target.name);
  const settings = getDeviceSettings(deviceType);

  const device = {
    id: target.id,
    name: target.name,
    address: target.id,
    rssi: 0,
    deviceType,
    bluetoothDevice: target.btDevice,
    characteristics: {
      serviceUUID: charUUIDs.service,
      batteryUUID: charUUIDs.battery,
      writeUUID: charUUIDs.write,
      notifyUUID: charUUIDs.notify,
      impedanceUUID: charUUIDs.impedance || null,
    },
    state: 'disconnected' as any,
    isStreaming: false,
    batteryLevel: null,
    connectedAt: null,
    eegBuffer: [],
    impedanceBuffer: [],
    stats: { packetsReceived: 0, packetsLost: 0, packetLossPercent: 0, bytesReceived: 0, startTime: null, lastPacketTime: null, effectiveSampleRate: 0 },
    validationResult: null,
    log: [],
    settings,
  };

  (manager as any).devices = new Map([[target.id, device]]);

  // Connect
  logger.info('connection', 'Connecting to second device...');
  const connected = await manager.connect(target.id);
  if (!connected) {
    logger.error('connection', 'Failed to connect to second device');
    logger.finalize();
    process.exit(1);
  }

  // Profile
  if (device.bluetoothDevice) {
    await profiler.profileDevice(device.bluetoothDevice);
  }

  // Validate
  logger.info('validation', 'Validating protocol...');
  const validation = await manager.validateProtocol(target.id);
  logger.info('validation', `Service found: ${validation.serviceFound}`);

  // Try streaming
  if (validation.serviceFound) {
    logger.info('streaming', 'Starting EEG...');
    const streaming = await manager.startSignal(target.id);
    if (streaming) {
      logger.success('streaming', 'EEG started!');
      await new Promise((r) => setTimeout(r, 5000));
      await manager.stopSignal(target.id);
    }
  }

  // Disconnect
  await manager.disconnect(target.id);

  logger.finalize();
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
