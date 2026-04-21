// Device Manager — scan, connect, disconnect, stream via webbluetooth

import { Bluetooth, getAdapters } from 'webbluetooth';
import type { BluetoothDevice, BluetoothRemoteGATTService, BluetoothRemoteGATTCharacteristic } from 'webbluetooth';
import type { NeiryDevice, DeviceCharacteristics, DeviceSettings, ProtocolValidationResult } from './types.js';
import {
  getServiceUUID,
  getCharacteristicUUIDs,
  detectDeviceType,
  getDeviceSettings,
  makeStartupSequence,
  makeStopSequence,
} from './protocol.js';
import { parseEEGData, parseBatteryData, createEmptyStats, createEmptyValidation } from './parser.js';
import { Logger } from './logger.js';
import { AppConfig } from './config.js';
import { ConnectionHistory } from './connection-history.js';

function sleep(ms: number) { return new Promise<void>((r) => setTimeout(r, ms)); }

function buf2hex(buf: DataView | ArrayBuffer | Uint8Array | null): string {
  if (!buf) return '<null>';
  let bytes: Uint8Array;
  if (buf instanceof DataView) bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  else if (buf instanceof ArrayBuffer) bytes = new Uint8Array(buf);
  else bytes = buf;
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join(' ');
}

function parseGattError(e: unknown): { msg: string; isConnLimit: boolean } {
  const raw = e instanceof Error ? e.message : String(e);
  const isConnLimit = raw.includes('0x85') || raw.includes('Connection limit') || raw.includes('Connection already exists');
  return { msg: raw, isConnLimit };
}

export interface DeviceManagerCallbacks {
  onDeviceDiscovered?: (device: NeiryDevice) => void;
  onDeviceConnected?: (device: NeiryDevice) => void;
  onDeviceDisconnected?: (device: NeiryDevice) => void;
  onDeviceError?: (device: NeiryDevice, error: string) => void;
  onEEGData?: (device: NeiryDevice, packet: ReturnType<typeof parseEEGData>) => void;
  onNotifyRaw?: (device: NeiryDevice, hex: string, bytes: number) => void;
}

export class DeviceManager {
  private bluetooth: Bluetooth;
  private devices = new Map<string, NeiryDevice>();
  private logger: Logger;
  private config: AppConfig;
  private callbacks: DeviceManagerCallbacks;
  private connectingSet = new Set<string>();
  private startingSet = new Set<string>();
  private notifyHandlers = new Map<string, (event: Event) => void>();
  private history: ConnectionHistory;

  constructor(logger: Logger, config: AppConfig, callbacks: DeviceManagerCallbacks = {}) {
    this.logger = logger;
    this.config = config;
    this.callbacks = callbacks;
    this.history = new ConnectionHistory(config.logDir);
    this.bluetooth = new Bluetooth({
      deviceFound: (device) => {
        const name = device.name || '';
        const match = config.namePrefixes.some((p) => name.startsWith(p));
        this.logger.debug('discovery', `deviceFound: "${name}" match=${match}`);
        return match;
      },
      scanTime: config.scanTime,
    });
  }

  getDevices(): NeiryDevice[] { return Array.from(this.devices.values()); }
  getDevice(id: string): NeiryDevice | undefined { return this.devices.get(id); }

  getAdapters(): Array<{index: number, address: string, active: boolean}> {
    try {
      const adapters = getAdapters();
      this.logger.info('diagnostics', `Adapters found: ${adapters.length}`, { adapters });
      return adapters;
    } catch (e) {
      this.logger.error('diagnostics', `Failed to get adapters: ${e instanceof Error ? e.message : String(e)}`);
      return [];
    }
  }

  async scan(): Promise<NeiryDevice[]> {
    this.logger.info('discovery', `=== Scanning for devices (scanTime=${this.config.scanTime}s) ===`);

    const services = [
      getServiceUUID('Headband').toLowerCase(),
      getServiceUUID('Headphone').toLowerCase(),
      '00001800-0000-1000-8000-00805f9b34fb',
      '00001801-0000-1000-8000-00805f9b34fb',
      '0000180f-0000-1000-8000-00805f9b34fb',
    ];
    const filters = this.config.namePrefixes.map((p) => ({ namePrefix: p }));

    this.logger.debug('discovery', `Filters: ${JSON.stringify(filters)}`);

    try {
      const btDevice = await this.bluetooth.requestDevice({
        filters,
        optionalServices: services,
      });

      if (!btDevice) {
        this.logger.warn('discovery', 'No device selected');
        return [];
      }

      const device = this.addDevice(btDevice);
      this.history.logScan(device.id, device.name, device.id, 'single scan');
      this.callbacks.onDeviceDiscovered?.(device);
      return [device];
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (m.includes('cancelled') || m.includes('User')) {
        this.logger.warn('discovery', 'User cancelled scan');
      } else {
        this.logger.error('discovery', `Scan failed: ${m}`, undefined, 'SCAN_FAILED');
      }
      return [];
    }
  }

  async scanMultiple(maxDevices: number): Promise<NeiryDevice[]> {
    this.logger.info('discovery', `=== Scanning for up to ${maxDevices} devices ===`);
    const found: NeiryDevice[] = [];

    const services = [
      getServiceUUID('Headband').toLowerCase(),
      getServiceUUID('Headphone').toLowerCase(),
      '00001800-0000-1000-8000-00805f9b34fb',
      '00001801-0000-1000-8000-00805f9b34fb',
      '0000180f-0000-1000-8000-00805f9b34fb',
    ];
    const filters = this.config.namePrefixes.map((p) => ({ namePrefix: p }));

    // Use deviceFound to collect multiple devices
    const seenIds = new Set<string>();
    const bt = new Bluetooth({
      deviceFound: (device) => {
        const name = device.name || '';
        const match = this.config.namePrefixes.some((p) => name.startsWith(p));
        if (!match) return false;
        if (seenIds.has(device.id)) return false;
        seenIds.add(device.id);

        this.logger.info('discovery', `Found: "${name}" id=${device.id}`, { deviceId: device.id, deviceName: name });
        return true; // Auto-select this device
      },
      scanTime: this.config.scanTime,
      allowAllDevices: false,
    });

    // webbluetooth returns first matched device. For multiple we need multiple requestDevice calls
    // or use getDevices() if paired before.
    // Each requestDevice call respects scanTime from Bluetooth constructor, but we also add
    // a per-iteration timeout to avoid blocking forever when fewer devices are available.
    const perDeviceTimeoutMs = (this.config.scanTime + 2) * 1000; // scanTime seconds + 2s buffer

    while (found.length < maxDevices) {
      this.logger.info('discovery', `Scanning for device ${found.length + 1}/${maxDevices} (timeout: ${perDeviceTimeoutMs}ms)...`);

      try {
        // Race requestDevice against a timeout to avoid hanging when no more devices are discoverable
        const btDevice = await Promise.race([
          bt.requestDevice({ filters, optionalServices: services }),
          new Promise<null>((_, reject) => {
            setTimeout(() => reject(new Error('SCAN_ITERATION_TIMEOUT')), perDeviceTimeoutMs);
          }),
        ]);

        if (!btDevice) break;
        if (this.devices.has(btDevice.id)) {
          this.logger.debug('discovery', `Device ${btDevice.id} already known, skipping`);
          continue;
        }
        const device = this.addDevice(btDevice);
        found.push(device);
        this.history.logScan(device.id, device.name, device.id, `multi scan ${found.length}/${maxDevices}`);
        this.callbacks.onDeviceDiscovered?.(device);
        this.logger.success('discovery', `Added ${device.name} (${found.length}/${maxDevices})`, { deviceId: device.id, deviceName: device.name });
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        if (m.includes('SCAN_ITERATION_TIMEOUT')) {
          this.logger.info('discovery', `Scan iteration timed out — no more devices found within ${perDeviceTimeoutMs}ms`);
          break;
        }
        if (m.includes('cancelled') || m.includes('User') || m.includes('timeout')) {
          this.logger.info('discovery', `Scan ended: ${m}`);
          break;
        }
        this.logger.error('discovery', `Scan error: ${m}`, undefined, 'SCAN_ERROR');
        break;
      }
    }

    this.logger.info('discovery', `Scan complete. Found ${found.length} device(s)`, { count: found.length });
    return found;
  }

  async connect(deviceId: string, attempt = 1): Promise<boolean> {
    if (this.connectingSet.has(deviceId)) {
      this.logger.warn('connection', `Already connecting ${deviceId}`);
      return false;
    }
    if (this.devices.get(deviceId)?.state === 'connected') {
      this.logger.warn('connection', `Already connected ${deviceId}`);
      return true;
    }

    this.connectingSet.add(deviceId);
    const device = this.devices.get(deviceId);

    try {
      if (!device) { this.logger.error('connection', `No device ${deviceId}`, undefined, 'NO_DEVICE'); return false; }
    if (!device.bluetoothDevice) {
        this.logger.error('connection', `No device ${deviceId}`, undefined, 'NO_DEVICE');
        return false;
      }

      this.history.logConnectAttempt(deviceId, device.name, attempt, this.config.connectMaxRetries);
      this.logger.deviceLog('connection', deviceId, device.name, 'connect', 'pending', `Attempt ${attempt}/${this.config.connectMaxRetries}`, 'info', undefined, { attempt, maxRetries: this.config.connectMaxRetries });
      device.state = 'connecting';

      const gatt = device.bluetoothDevice.gatt;
      if (!gatt) {
        this.logger.deviceLog('connection', deviceId, device.name, 'connect', 'failure', 'GATT not available', 'error', 'NO_GATT');
        device.state = 'error';
        return false;
      }

      await gatt.connect();

      const liveGatt = device.bluetoothDevice.gatt;
      if (!liveGatt || !liveGatt.connected) {
        this.logger.deviceLog('connection', deviceId, device.name, 'connect', 'failure', 'GATT connected but immediately disconnected', 'error', 'GATT_DROPPED');
        device.state = 'error';
        return false;
      }

      device.gattServer = liveGatt;
      device.connectedAt = Date.now();
      device.state = 'connected';

      // Disconnect handler
      const disconnectHandler = () => {
        this.logger.deviceLog('connection', deviceId, device.name, 'disconnect', 'success', 'GATT server disconnected', 'warn');
        device.state = 'disconnected';
        device.isStreaming = false;
        device.gattServer = undefined;
        this.callbacks.onDeviceDisconnected?.(device);
      };
      device.bluetoothDevice.removeEventListener('gattserverdisconnected', disconnectHandler);
      device.bluetoothDevice.addEventListener('gattserverdisconnected', disconnectHandler);

      await sleep(100);

      // Read battery
      try {
        if (device.gattServer?.connected) {
          await this.readBattery(device);
          this.logger.deviceLog('connection', deviceId, device.name, 'readBattery', 'success', `Battery = ${device.batteryLevel}%`, 'info');
        }
      } catch (e) {
        this.logger.deviceLog('connection', deviceId, device.name, 'readBattery', 'failure', String(e), 'warn');
      }

      this.history.logConnectSuccess(deviceId, device.name, Date.now() - (device.connectedAt || Date.now()));
      this.logger.deviceLog('connection', deviceId, device.name, 'connect', 'success', 'Connected', 'success');
      this.callbacks.onDeviceConnected?.(device);
      return true;

    } catch (e) {
      const { msg, isConnLimit } = parseGattError(e);
      this.history.logConnectFail(deviceId, device?.name || deviceId, isConnLimit ? '0x85' : 'CONN_ERROR', msg);
      this.logger.deviceLog('connection', deviceId, device?.name || deviceId, 'connect', 'failure', msg, 'error', isConnLimit ? '0x85' : 'CONN_ERROR', { attempt, isConnLimit });

      if (isConnLimit && attempt < this.config.connectMaxRetries) {
        this.logger.warn('connection', `Connection limit (0x85), retrying in ${this.config.connectRetryDelay}ms...`, { deviceId, attempt });
        device.state = 'disconnected';
        await sleep(this.config.connectRetryDelay);
        this.connectingSet.delete(deviceId);
        return this.connect(deviceId, attempt + 1);
      }

      device.state = 'error';
      this.callbacks.onDeviceError?.(device || this.makeStubDevice(deviceId), msg);
      return false;
    } finally {
      this.connectingSet.delete(deviceId);
    }
  }

  async disconnect(deviceId: string): Promise<void> {
    const device = this.devices.get(deviceId);
    if (!device) return;

    this.connectingSet.delete(deviceId);
    this.startingSet.delete(deviceId);

    if (device.isStreaming) {
      try { await this.stopSignal(deviceId); } catch (e) { /* ignore */ }
    }

    try {
      if (device.gattServer) {
        device.gattServer.disconnect();
      }
    } catch (e) {
      this.logger.warn('connection', `disconnect threw: ${e instanceof Error ? e.message : String(e)}`, { deviceId });
    }

    device.gattServer = undefined;
    device.isStreaming = false;
    device.state = 'disconnected';
    this.history.logDisconnect(deviceId, device.name);
    this.logger.deviceLog('connection', deviceId, device.name, 'disconnect', 'success', 'Disconnected', 'info');
    this.callbacks.onDeviceDisconnected?.(device);

    await sleep(3000); // BLE stack cleanup (was 2000, increased for Windows)
  }

  async startSignal(deviceId: string): Promise<boolean> {
    if (this.startingSet.has(deviceId)) return false;
    if (this.devices.get(deviceId)?.isStreaming) return true;

    this.startingSet.add(deviceId);
    const device = this.devices.get(deviceId);

    try {
      if (!device) { this.logger.error('streaming', `Not connected: ${deviceId}`, undefined, 'NOT_CONNECTED'); return false; }
    if (!device.gattServer?.connected) {
        this.logger.error('streaming', `Not connected: ${deviceId}`, undefined, 'NOT_CONNECTED');
        return false;
      }

      this.history.logStreamStart(deviceId, device.name);
      this.logger.deviceLog('streaming', deviceId, device.name, 'startSignal', 'pending', 'Starting EEG...', 'info');

      let service: BluetoothRemoteGATTService;
      try {
        service = await device.gattServer.getPrimaryService(device.characteristics.serviceUUID.toLowerCase());
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        this.logger.deviceLog('streaming', deviceId, device.name, 'getPrimaryService', 'failure', m, 'error', 'SERVICE_ERROR');
        return false;
      }

      let notifyChar: BluetoothRemoteGATTCharacteristic;
      let writeChar: BluetoothRemoteGATTCharacteristic;
      try {
        notifyChar = await service.getCharacteristic(device.characteristics.notifyUUID.toLowerCase());
        writeChar = await service.getCharacteristic(device.characteristics.writeUUID.toLowerCase());
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        this.logger.deviceLog('streaming', deviceId, device.name, 'getCharacteristic', 'failure', m, 'error', 'CHAR_ERROR');
        return false;
      }

      // Start notifications
      try {
        await notifyChar.startNotifications();
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        this.logger.deviceLog('streaming', deviceId, device.name, 'startNotifications', 'failure', m, 'error', 'NOTIFY_ERROR');
        return false;
      }

      // Data handler
      const onNotify = (event: Event) => {
        const ch = event.target as BluetoothRemoteGATTCharacteristic;
        const value = ch.value;
        if (!value) return;

        const hex = buf2hex(value);
        const bytes = value.byteLength;
        this.callbacks.onNotifyRaw?.(device, hex, bytes);

        const packet = parseEEGData(value, device.settings, device.stats);
        if (packet) {
          const maxBuffer = 2000;
          for (const [chName, val] of Object.entries(packet.samples)) {
            device.eegBuffer.push({ timestamp: packet.timestamp, channel: chName, value: val });
          }
          while (device.eegBuffer.length > maxBuffer) device.eegBuffer.shift();
          this.callbacks.onEEGData?.(device, packet);
        }
      };

      // Remove old handler if exists
      const oldHandler = this.notifyHandlers.get(deviceId);
      if (oldHandler) notifyChar.removeEventListener('characteristicvaluechanged', oldHandler);
      this.notifyHandlers.set(deviceId, onNotify);
      notifyChar.addEventListener('characteristicvaluechanged', onNotify);

      // Startup sequence
      const sequence = makeStartupSequence(device.settings);
      for (let i = 0; i < sequence.length; i++) {
        const step = sequence[i];
        const hex = Array.from(step.cmd).map((b) => `0x${b.toString(16).padStart(2, '0')}`).join(' ');
        try {
          this.logger.tx('streaming', `Step ${i + 1}/${sequence.length}: [${hex}] delay=${step.delay}ms`, { deviceId, deviceName: device.name });
          await writeChar.writeValueWithResponse(step.cmd.buffer as ArrayBuffer);
          if (step.delay > 0) await sleep(step.delay);
        } catch (e) {
          const m = e instanceof Error ? e.message : String(e);
          this.logger.deviceLog('streaming', deviceId, device.name, 'write', 'failure', `Step ${i + 1} failed: ${m}`, 'error', 'WRITE_ERROR');
          return false;
        }
      }

      device.isStreaming = true;
      device.stats.startTime = performance.now() / 1000;
      this.logger.deviceLog('streaming', deviceId, device.name, 'startSignal', 'success', 'EEG streaming started', 'success');
      return true;

    } finally {
      this.startingSet.delete(deviceId);
    }
  }

  async stopSignal(deviceId: string): Promise<boolean> {
    const device = this.devices.get(deviceId);
    if (!device?.gattServer?.connected) return false;

    this.logger.deviceLog('streaming', deviceId, device.name, 'stopSignal', 'pending', 'Stopping EEG...', 'info');

    try {
      const service = await device.gattServer.getPrimaryService(device.characteristics.serviceUUID.toLowerCase());
      const writeChar = await service.getCharacteristic(device.characteristics.writeUUID.toLowerCase());
      const notifyChar = await service.getCharacteristic(device.characteristics.notifyUUID.toLowerCase());

      for (const step of makeStopSequence()) {
        const hex = Array.from(step.cmd).map((b) => `0x${b.toString(16)}`).join(' ');
        this.logger.tx('streaming', `Stop [${hex}]`, { deviceId, deviceName: device.name });
        await writeChar.writeValue(step.cmd.buffer as ArrayBuffer);
        if (step.delay > 0) await sleep(step.delay);
      }

      try {
        await notifyChar.stopNotifications();
        const handler = this.notifyHandlers.get(deviceId);
        if (handler) {
          notifyChar.removeEventListener('characteristicvaluechanged', handler);
          this.notifyHandlers.delete(deviceId);
        }
      } catch { /* ignore */ }

      device.isStreaming = false;
      this.logger.deviceLog('streaming', deviceId, device.name, 'stopSignal', 'success', 'EEG streaming stopped', 'success');
      return true;
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      this.logger.deviceLog('streaming', deviceId, device.name, 'stopSignal', 'failure', m, 'error', 'STOP_ERROR');
      return false;
    }
  }

  async validateProtocol(deviceId: string): Promise<ProtocolValidationResult> {
    const device = this.devices.get(deviceId);
    if (!device?.gattServer?.connected) {
      return { ...createEmptyValidation(), serviceUUID: device?.characteristics.serviceUUID || '' };
    }

    this.logger.deviceLog('validation', deviceId, device.name, 'validateProtocol', 'pending', 'Validating...', 'info');
    const result = createEmptyValidation();
    result.serviceUUID = device.characteristics.serviceUUID;

    try {
      const svc = await device.gattServer.getPrimaryService(device.characteristics.serviceUUID.toLowerCase());
      result.serviceFound = true;

      const chars = await svc.getCharacteristics();
      const expBat = device.characteristics.batteryUUID.toLowerCase();
      const expWrite = device.characteristics.writeUUID.toLowerCase();
      const expNotify = device.characteristics.notifyUUID.toLowerCase();

      for (const char of chars) {
        const cu = char.uuid.toLowerCase();
        if (cu === expBat) {
          result.characteristicsFound.battery = true;
          try { const val = await char.readValue(); result.batteryReadable = true; device.batteryLevel = parseBatteryData(val); } catch { }
        }
        if (cu === expWrite) { result.characteristicsFound.write = true; result.writeWorking = !!(char.properties.write || char.properties.writeWithoutResponse); }
        if (cu === expNotify) { result.characteristicsFound.notify = true; result.notifyWorking = char.properties.notify; }
      }

      const foundCount = Object.values(result.characteristicsFound).filter(Boolean).length;
      this.logger.deviceLog('validation', deviceId, device.name, 'validateProtocol', 'success', `${foundCount}/${Object.keys(result.characteristicsFound).length} chars OK`, 'success', undefined, { result });
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      this.logger.deviceLog('validation', deviceId, device.name, 'validateProtocol', 'failure', m, 'error', 'VALIDATION_ERROR');
    }

    device.validationResult = result;
    return result;
  }

  private addDevice(btDevice: BluetoothDevice): NeiryDevice {
    const id = btDevice.id;
    const name = btDevice.name || 'Unknown';
    const deviceType = detectDeviceType(name);
    const charUUIDs = getCharacteristicUUIDs(name);
    const settings = getDeviceSettings(deviceType);

    const chars: DeviceCharacteristics = {
      serviceUUID: charUUIDs.service,
      batteryUUID: charUUIDs.battery,
      writeUUID: charUUIDs.write,
      notifyUUID: charUUIDs.notify,
      impedanceUUID: charUUIDs.impedance || null,
    };

    const device: NeiryDevice = {
      id, name, address: btDevice.id, rssi: 0, deviceType,
      bluetoothDevice: btDevice as unknown as BluetoothDevice, characteristics: chars,
      state: 'disconnected', isStreaming: false, batteryLevel: null, connectedAt: null,
      eegBuffer: [], impedanceBuffer: [], stats: createEmptyStats(),
      validationResult: null, log: [], settings,
    };

    this.devices.set(id, device);
    this.logger.deviceLog('discovery', id, name, 'addDevice', 'success', `Discovered: ${name}`, 'success', undefined, { deviceType });
    return device;
  }

  private async readBattery(device: NeiryDevice): Promise<void> {
    if (!device.gattServer) return;
    const svc = await device.gattServer.getPrimaryService(device.characteristics.serviceUUID.toLowerCase());
    const char = await svc.getCharacteristic(device.characteristics.batteryUUID.toLowerCase());
    const value = await char.readValue();
    device.batteryLevel = parseBatteryData(value);
  }

  private makeStubDevice(id: string): NeiryDevice {
    return {
      id, name: id, address: id, rssi: 0, deviceType: 'unknown',
      characteristics: { serviceUUID: '', batteryUUID: '', writeUUID: '', notifyUUID: '', impedanceUUID: null },
      state: 'error', isStreaming: false, batteryLevel: null, connectedAt: null,
      eegBuffer: [], impedanceBuffer: [], stats: createEmptyStats(),
      validationResult: null, log: [], settings: getDeviceSettings('unknown'),
    };
  }
}
