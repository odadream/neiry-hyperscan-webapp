import type { NeiryDevice, LogEntry, DeviceCharacteristics, ProtocolValidationResult } from '@/types/bluetooth';
import { getServiceUUID, getCharacteristicUUIDs, detectDeviceType, getDeviceSettings, makeStartupSequence, makeStopSequence } from './protocol';
import { parseEEGData, parseBatteryData, createEmptyStats, createEmptyValidation } from './parser';
import { logger } from './logger';

export type DeviceCallback = (device: NeiryDevice) => void;

function buf2hex(buf: DataView | ArrayBuffer | Uint8Array | null): string {
  if (!buf) return '<null>';
  let bytes: Uint8Array;
  if (buf instanceof DataView) bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  else if (buf instanceof ArrayBuffer) bytes = new Uint8Array(buf);
  else bytes = buf;
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join(' ');
}

function sleep(ms: number) { return new Promise<void>((r) => setTimeout(r, ms)); }

// Parse error code from Web Bluetooth
function parseGattError(e: unknown): { msg: string; isConnLimit: boolean; isUnknown: boolean } {
  const raw = e instanceof Error ? e.message : String(e);
  const isConnLimit = raw.includes('0x85') || raw.includes('Connection limit') || raw.includes('Connection already exists');
  const isUnknown = raw.includes('0x85') || raw.includes('Unknown');
  return { msg: raw, isConnLimit, isUnknown };
}

class BluetoothManager {
  private devices: Map<string, NeiryDevice> = new Map();
  private onChange?: DeviceCallback;
  private connectingSet: Set<string> = new Set();
  private startingSet: Set<string> = new Set();

  setOnChange(cb: DeviceCallback) { this.onChange = cb; }
  getDevices(): NeiryDevice[] { return Array.from(this.devices.values()); }
  getDevice(id: string): NeiryDevice | undefined { return this.devices.get(id); }

  isSupported(): boolean {
    const ok = typeof navigator !== 'undefined' && 'bluetooth' in navigator;
    return ok;
  }

  async requestDevice(): Promise<BluetoothDevice | null> {
    logger.info('BT', '>>> requestDevice()');
    if (!this.isSupported()) { logger.error('BT', 'Web Bluetooth not supported'); throw new Error('Web Bluetooth not supported'); }

    const services = [
      getServiceUUID('Headband').toLowerCase(),
      getServiceUUID('Headphone').toLowerCase(),
      '00001800-0000-1000-8000-00805f9b34fb', // Generic Access
      '00001801-0000-1000-8000-00805f9b34fb', // Generic Attribute
      '0000180f-0000-1000-8000-00805f9b34fb', // Battery Service
    ];
    const filters = [{ namePrefix: 'Headband' }, { namePrefix: 'Headphone' }, { namePrefix: 'BrainBit' }];
    logger.debug('BT', `filters: ${JSON.stringify(filters)}`);
    logger.debug('BT', `optionalServices: ${services.join(', ')}`);

    try {
      const device = await navigator.bluetooth.requestDevice({ filters, optionalServices: services });
      logger.success('BT', `requestDevice OK: "${device.name || 'null'}" id="${device.id}" gatt=${device.gatt ? 'ok' : 'null'}`);
      return device;
    } catch (err: unknown) {
      const m = err instanceof Error ? err.message : String(err);
      if (m.includes('cancelled') || m.includes('User')) { logger.warn('BT', 'User cancelled picker'); }
      else { logger.error('BT', `requestDevice failed: ${m}`); }
      return null;
    }
  }

  async scanAndAdd(): Promise<NeiryDevice | null> {
    logger.info('BT', '=== scanAndAdd() ===');
    const btDevice = await this.requestDevice();
    if (!btDevice) return null;

    const id = btDevice.id;
    const name = btDevice.name || 'Unknown';
    const existing = this.devices.get(id);
    if (existing) { existing.bluetoothDevice = btDevice; this.emitChange(existing); return existing; }

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
      bluetoothDevice: btDevice, characteristics: chars,
      state: 'disconnected', isStreaming: false, batteryLevel: null, connectedAt: null,
      eegBuffer: [], impedanceBuffer: [], stats: createEmptyStats(),
      validationResult: null, log: [], settings,
    };

    this.devices.set(id, device);
    this.addDeviceLog(device, 'info', `Discovered: ${name}`);
    this.emitChange(device);
    logger.success('BT', `scanAndAdd: "${name}" ready`);
    return device;
  }

  async connect(deviceId: string, attempt = 1): Promise<boolean> {
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 1500;

    if (this.connectingSet.has(deviceId)) { logger.warn('BT', `connect(${deviceId}): already in progress`); return false; }
    if (this.devices.get(deviceId)?.state === 'connected') { logger.warn('BT', `connect(${deviceId}): already connected`); return false; }
    this.connectingSet.add(deviceId);

    try {
      const device = this.devices.get(deviceId);
      if (!device || !device.bluetoothDevice) { logger.error('BT', `connect: no device`); return false; }

      // Force cleanup stale connection
      if (device.gattServer && !device.gattServer.connected) {
        logger.warn('BT', `Stale gattServer detected, clearing`);
        device.gattServer = undefined;
      }

      logger.info('BT', `=== connect("${device.name}") attempt=${attempt}/${MAX_RETRIES} ===`);
      this.setState(device, 'connecting');
      this.addDeviceLog(device, 'info', `Connecting (attempt ${attempt})...`);

      if (!device.bluetoothDevice.gatt) {
        this.setState(device, 'error');
        this.addDeviceLog(device, 'error', 'GATT not available — pair in Android settings first');
        this.emitChange(device);
        return false;
      }

      try {
        await device.bluetoothDevice.gatt.connect();

        // CRITICAL: Use live device.gatt reference, not returned server object
        // The returned server may become stale; device.gatt is updated by browser
        const liveGatt = device.bluetoothDevice.gatt;
        if (!liveGatt || !liveGatt.connected) {
          logger.error('BT', `gatt.connect() resolved but liveGatt.connected=${liveGatt?.connected}`);
          this.setState(device, 'error');
          this.addDeviceLog(device, 'error', 'GATT connected but immediately disconnected');
          this.emitChange(device);
          return false;
        }

        device.gattServer = liveGatt;
        device.connectedAt = Date.now();
        this.setState(device, 'connected');
        this.addDeviceLog(device, 'success', 'Connected');
        logger.info('BT', `liveGatt.connected=true, connection stable`);

        // Disconnect listener (add once, BEFORE any operations)
        const handler = () => {
          logger.warn('BT', `gattserverdisconnected for "${device.name}"`);
          if (device.state !== 'disconnected') {
            this.setState(device, 'disconnected');
            device.isStreaming = false;
            device.gattServer = undefined;
            this.addDeviceLog(device, 'warning', 'Disconnected (server lost)');
            this.emitChange(device);
          }
        };
        device.bluetoothDevice.removeEventListener('gattserverdisconnected', handler);
        device.bluetoothDevice.addEventListener('gattserverdisconnected', handler);

        // Wait a moment for connection to stabilize
        await sleep(100);

        // Try battery using live gatt reference
        try {
          if (device.gattServer?.connected) {
            await this.readBattery(device);
            logger.info('BT', `Battery = ${device.batteryLevel}%`);
          } else {
            logger.warn('BT', 'Battery read skipped: GATT disconnected before battery read');
          }
        } catch (e: unknown) {
          logger.warn('BT', `Battery read skipped: ${e instanceof Error ? e.message : String(e)}`);
        }

        this.emitChange(device);
        logger.success('BT', `connect("${device.name}"): SUCCESS`);
        return true;

      } catch (e: unknown) {
        const { msg, isConnLimit } = parseGattError(e);
        logger.error('BT', `connect("${device.name}") FAILED: ${msg}`);

        if (isConnLimit && attempt < MAX_RETRIES) {
          logger.warn('BT', `Connection limit error 0x85 detected, retrying in ${RETRY_DELAY}ms...`);
          this.addDeviceLog(device, 'warning', `BLE limit hit, retry ${attempt + 1}/${MAX_RETRIES}...`);
          this.setState(device, 'disconnected');
          this.emitChange(device);
          await sleep(RETRY_DELAY);
          return this.connect(deviceId, attempt + 1);
        }

        this.setState(device, 'error');
        this.addDeviceLog(device, 'error', isConnLimit ? 'BLE connection limit — restart Bluetooth' : `Connection failed: ${msg}`);
        this.emitChange(device);
        return false;
      }
    } finally {
      this.connectingSet.delete(deviceId);
    }
  }

  async disconnect(deviceId: string): Promise<void> {
    const device = this.devices.get(deviceId);
    if (!device) { logger.warn('BT', `disconnect(${deviceId}): device not found`); return; }

    this.connectingSet.delete(deviceId);
    this.startingSet.delete(deviceId);

    logger.info('BT', `=== disconnect("${device.name}") state=${device.state} connected=${device.gattServer?.connected} ===`);

    if (device.state === 'disconnected' && !device.gattServer?.connected) {
      logger.info('BT', `Already disconnected, skipping`);
      return;
    }

    this.setState(device, 'disconnecting');

    // Stop signal first (sends idle command + stops notifications)
    if (device.isStreaming) {
      try { await this.stopSignal(deviceId); }
      catch (e: unknown) { logger.warn('BT', `stopSignal during disconnect: ${e instanceof Error ? e.message : String(e)}`); }
    }

    // Disconnect GATT
    try {
      if (device.gattServer) {
        logger.info('BT', `Calling gattServer.disconnect()...`);
        device.gattServer.disconnect();
        logger.success('BT', 'gattServer.disconnect() called');
      } else {
        logger.warn('BT', 'gattServer is null, cannot disconnect');
      }
    } catch (e: unknown) {
      logger.warn('BT', `gattServer.disconnect() threw: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Force cleanup regardless
    device.gattServer = undefined;
    device.isStreaming = false;
    this.setState(device, 'disconnected');
    this.addDeviceLog(device, 'info', 'Disconnected');
    this.emitChange(device);

    // CRITICAL: Android BLE stack needs time to release connection
    logger.info('BT', 'Waiting 2000ms for Android BLE stack cleanup...');
    await sleep(2000);
    logger.info('BT', 'Disconnect complete, BLE stack should be clean');
  }

  async startSignal(deviceId: string): Promise<boolean> {
    if (this.startingSet.has(deviceId)) { logger.warn('BT', `startSignal(${deviceId}): already in progress`); return false; }
    if (this.devices.get(deviceId)?.isStreaming) { logger.warn('BT', `startSignal(${deviceId}): already streaming`); return false; }
    this.startingSet.add(deviceId);

    try {
      const device = this.devices.get(deviceId);
      // Check live gatt reference, not stale gattServer
      const liveConnected = device?.bluetoothDevice?.gatt?.connected || device?.gattServer?.connected;
      if (!device || !liveConnected) {
        logger.error('BT', `startSignal: not connected (liveConnected=${liveConnected}, gattServer=${device?.gattServer?.connected})`);
        return false;
      }

      logger.info('BT', `=== startSignal("${device.name}") ===`);
      this.addDeviceLog(device, 'info', 'Starting EEG...');

      let service: BluetoothRemoteGATTService;
      try {
        logger.info('BT', `getPrimaryService(${device.characteristics.serviceUUID})`);
        service = await device.gattServer!.getPrimaryService(device.characteristics.serviceUUID.toLowerCase());
        logger.success('BT', 'Primary service acquired');
      } catch (e: unknown) {
        const m = e instanceof Error ? e.message : String(e);
        logger.error('BT', `getPrimaryService FAILED: ${m}`);
        this.addDeviceLog(device, 'error', `Service not accessible: ${m}. Try removing and re-adding the device.`);
        this.emitChange(device);
        return false;
      }

      let notifyChar: BluetoothRemoteGATTCharacteristic;
      let writeChar: BluetoothRemoteGATTCharacteristic;
      try {
        notifyChar = await service.getCharacteristic(device.characteristics.notifyUUID.toLowerCase());
        logger.success('BT', `Notify char OK: ${notifyChar.uuid}`);
        writeChar = await service.getCharacteristic(device.characteristics.writeUUID.toLowerCase());
        logger.success('BT', `Write char OK: ${writeChar.uuid}`);
      } catch (e: unknown) {
        const m = e instanceof Error ? e.message : String(e);
        logger.error('BT', `getCharacteristic FAILED: ${m}`);
        this.addDeviceLog(device, 'error', `Characteristic error: ${m}`);
        this.emitChange(device);
        return false;
      }

      // Start notifications
      try {
        logger.info('BT', 'startNotifications()...');
        await notifyChar.startNotifications();
        logger.success('BT', 'Notifications started');
      } catch (e: unknown) {
        const m = e instanceof Error ? e.message : String(e);
        logger.error('BT', `startNotifications FAILED: ${m}`);
        this.addDeviceLog(device, 'error', `Notifications failed: ${m}`);
        this.emitChange(device);
        return false;
      }

      // Data handler — logs to eegStore, NOT to system logger
      const onNotify = (event: Event) => {
        const ch = event.target as BluetoothRemoteGATTCharacteristic;
        const value = ch.value;
        if (!value) return;

        const hex = buf2hex(value);
        const packet = parseEEGData(value, device.settings, device.stats);

        // Log to EEG Data Store (separate from system log)
        logger.eegPush({
          ts: Date.now(),
          deviceId: device.id,
          deviceName: device.name,
          hex,
          bytes: value.byteLength,
          packetNum: packet?.packetNum,
          channels: packet ? Object.keys(packet.samples).join(',') : undefined,
        });

        if (!packet) return;

        const maxBuffer = 2000;
        for (const [chName, val] of Object.entries(packet.samples)) {
          device.eegBuffer.push({ timestamp: packet.timestamp, channel: chName, value: val });
        }
        while (device.eegBuffer.length > maxBuffer) device.eegBuffer.shift();
        this.emitChange(device);
      };
      notifyChar.addEventListener('characteristicvaluechanged', onNotify);
      logger.info('BT', 'Notify listener attached');

      // Send startup sequence
      const sequence = makeStartupSequence(device.settings);
      logger.info('BT', `Startup sequence: ${sequence.length} steps`);
      for (let i = 0; i < sequence.length; i++) {
        const step = sequence[i];
        const hex = Array.from(step.cmd).map((b) => `0x${b.toString(16).padStart(2, '0')}`).join(' ');
        try {
          logger.tx('BT', `Step ${i + 1}: [${hex}] delay=${step.delay}ms`);
          await writeChar.writeValueWithResponse(step.cmd.buffer as ArrayBuffer);
          if (step.delay > 0) await sleep(step.delay);
        } catch (e: unknown) {
          const m = e instanceof Error ? e.message : String(e);
          logger.error('BT', `Write step ${i + 1} FAILED: ${m}`);
          this.addDeviceLog(device, 'error', `Write failed at step ${i + 1}: ${m}`);
          this.emitChange(device);
          return false;
        }
      }

      device.isStreaming = true;
      device.stats.startTime = performance.now() / 1000;
      this.addDeviceLog(device, 'success', 'EEG streaming started');
      logger.success('BT', `startSignal("${device.name}"): SUCCESS`);
      this.emitChange(device);
      return true;
    } finally {
      this.startingSet.delete(deviceId);
    }
  }

  async stopSignal(deviceId: string): Promise<boolean> {
    const device = this.devices.get(deviceId);
    if (!device?.gattServer?.connected) return false;

    logger.info('BT', `=== stopSignal("${device.name}") ===`);
    try {
      const service = await device.gattServer.getPrimaryService(device.characteristics.serviceUUID.toLowerCase());
      const writeChar = await service.getCharacteristic(device.characteristics.writeUUID.toLowerCase());
      const notifyChar = await service.getCharacteristic(device.characteristics.notifyUUID.toLowerCase());

      for (const step of makeStopSequence()) {
        const hex = Array.from(step.cmd).map((b) => `0x${b.toString(16)}`).join(' ');
        logger.tx('BT', `Stop [${hex}]`);
        await writeChar.writeValue(step.cmd.buffer as ArrayBuffer);
        if (step.delay > 0) await sleep(step.delay);
      }

      try { await notifyChar.stopNotifications(); logger.info('BT', 'Notifications stopped'); }
      catch { logger.warn('BT', 'stopNotifications threw'); }

      device.isStreaming = false;
      this.addDeviceLog(device, 'info', 'EEG streaming stopped');
      this.emitChange(device);
      return true;
    } catch (e: unknown) {
      logger.error('BT', `stopSignal: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }

  async validateProtocol(deviceId: string): Promise<ProtocolValidationResult> {
    const device = this.devices.get(deviceId);
    if (!device?.gattServer?.connected) {
      return { ...createEmptyValidation(), serviceUUID: device?.characteristics.serviceUUID || '' };
    }

    logger.info('BT', `=== validateProtocol("${device.name}") ===`);
    const result: ProtocolValidationResult = {
      serviceFound: false, serviceUUID: device.characteristics.serviceUUID,
      characteristicsFound: {},
      characteristicUUIDs: {
        battery: device.characteristics.batteryUUID, write: device.characteristics.writeUUID,
        notify: device.characteristics.notifyUUID,
        ...(device.characteristics.impedanceUUID ? { impedance: device.characteristics.impedanceUUID } : {}),
      },
      notifyWorking: false, writeWorking: false, batteryReadable: false,
    };

    // Check service via getPrimaryService (NOT getPrimaryServices — avoids Chrome security error)
    try {
      logger.info('BT', `Checking primary service: ${device.characteristics.serviceUUID}`);
      const svc = await device.gattServer.getPrimaryService(device.characteristics.serviceUUID.toLowerCase());
      result.serviceFound = true;
      logger.success('BT', 'Primary service accessible');

      // Check characteristics
      logger.info('BT', 'Checking characteristics...');
      const chars = await svc.getCharacteristics();
      logger.info('BT', `Found ${chars.length} characteristics`);

      const expBat = device.characteristics.batteryUUID.toLowerCase();
      const expWrite = device.characteristics.writeUUID.toLowerCase();
      const expNotify = device.characteristics.notifyUUID.toLowerCase();
      const expImp = device.characteristics.impedanceUUID?.toLowerCase();

      for (const char of chars) {
        const cu = char.uuid.toLowerCase();
        logger.debug('BT', `  Char ${cu}: notify=${char.properties.notify} read=${char.properties.read} write=${char.properties.write}`);

        if (cu === expBat) {
          result.characteristicsFound.battery = true;
          try { const val = await char.readValue(); result.batteryReadable = true; device.batteryLevel = parseBatteryData(val); logger.success('BT', `Battery OK = ${device.batteryLevel}%`); }
          catch { result.batteryReadable = false; logger.warn('BT', 'Battery read failed'); }
        }
        if (cu === expWrite) { result.characteristicsFound.write = true; result.writeWorking = !!(char.properties.write || char.properties.writeWithoutResponse); logger.success('BT', `Write OK (working=${result.writeWorking})`); }
        if (cu === expNotify) { result.characteristicsFound.notify = true; result.notifyWorking = char.properties.notify; logger.success('BT', `Notify OK (working=${result.notifyWorking})`); }
        if (expImp && cu === expImp) { result.characteristicsFound.impedance = true; logger.success('BT', 'Impedance OK'); }
      }
    } catch (e: unknown) {
      const m = e instanceof Error ? e.message : String(e);
      logger.error('BT', `validateProtocol error: ${m}`);
    }

    const foundCount = Object.values(result.characteristicsFound).filter(Boolean).length;
    const totalCount = Object.keys(result.characteristicsFound).length;
    device.validationResult = result;
    this.addDeviceLog(device, result.serviceFound ? 'success' : 'error', `Validation: ${foundCount}/${totalCount} chars, service=${result.serviceFound ? 'OK' : 'FAIL'}`);
    this.emitChange(device);
    return result;
  }

  async readBattery(device: NeiryDevice): Promise<void> {
    if (!device.gattServer) return;
    const svc = await device.gattServer.getPrimaryService(device.characteristics.serviceUUID.toLowerCase());
    const char = await svc.getCharacteristic(device.characteristics.batteryUUID.toLowerCase());
    const value = await char.readValue();
    device.batteryLevel = parseBatteryData(value);
  }

  async testMaxConnections(): Promise<{ attempted: number; connected: number; errors: string[] }> {
    const errors: string[] = []; let connected = 0;
    const toTest = this.getDevices().filter((d) => d.state === 'disconnected');
    for (const device of toTest) {
      logger.info('BT', `Attempting ${device.name}...`);
      try { if (await this.connect(device.id)) { connected++; logger.success('BT', `${device.name}: CONNECTED`); } }
      catch (e: unknown) { const m = e instanceof Error ? e.message : String(e); errors.push(`${device.name}: ${m}`); logger.error('BT', `${device.name}: ${m}`); }
    }
    return { attempted: toTest.length, connected, errors };
  }

  removeDevice(deviceId: string): void {
    const device = this.devices.get(deviceId);
    if (device) { this.connectingSet.delete(deviceId); this.startingSet.delete(deviceId); if (device.gattServer?.connected) this.disconnect(deviceId); }
    this.devices.delete(deviceId);
  }

  exportCSV(deviceId: string): string {
    const device = this.devices.get(deviceId);
    if (!device) return '';
    const header = ['timestamp', 'channel', 'value_uv'];
    const rows: string[] = [];
    for (const pt of device.eegBuffer) { rows.push(`${pt.timestamp.toFixed(6)},${pt.channel},${pt.value.toFixed(4)}`); }
    return [header.join(','), ...rows].join('\n');
  }

  private setState(device: NeiryDevice, state: NeiryDevice['state']) {
    if (device.state !== state) { logger.debug('BT', `"${device.name}": ${device.state} -> ${state}`); device.state = state; }
  }
  private addDeviceLog(device: NeiryDevice, level: LogEntry['level'], message: string) {
    device.log.push({ timestamp: Date.now(), level, message });
    if (device.log.length > 200) device.log.splice(0, 50);
  }
  private emitChange(device: NeiryDevice) { this.onChange?.({ ...device }); }
}

let manager: BluetoothManager | null = null;
export function getBluetoothManager(): BluetoothManager {
  if (!manager) manager = new BluetoothManager();
  return manager;
}
