// Device Profiler — reads Device Information Service and device capabilities

import type { BluetoothDevice } from 'webbluetooth';
import { Logger } from './logger.js';

// Standard BLE Device Information Service UUIDs
const DIS_SERVICE_UUID = '0000180a-0000-1000-8000-00805f9b34fb';
const DIS_CHARACTERISTICS = {
  manufacturerName: '00002a29-0000-1000-8000-00805f9b34fb',
  modelNumber:      '00002a24-0000-1000-8000-00805f9b34fb',
  serialNumber:     '00002a25-0000-1000-8000-00805f9b34fb',
  hardwareRevision: '00002a27-0000-1000-8000-00805f9b34fb',
  firmwareRevision: '00002a26-0000-1000-8000-00805f9b34fb',
  softwareRevision: '00002a28-0000-1000-8000-00805f9b34fb',
  systemId:         '00002a23-0000-1000-8000-00805f9b34fb',
  pnpId:            '00002a50-0000-1000-8000-00805f9b34fb',
};

export interface DeviceProfile {
  deviceId: string;
  deviceName: string;
  // DIS data
  manufacturerName?: string;
  modelNumber?: string;
  serialNumber?: string;
  hardwareRevision?: string;
  firmwareRevision?: string;
  softwareRevision?: string;
  systemId?: string;
  pnpId?: string;
  // GATT services discovered
  primaryServices: string[];
  // Connection info
  rssi?: number;
  mtu?: number;
  connectionInterval?: number;
  // Advertised data (if available)
  advertisedServices?: string[];
  // Analysis
  firmwareOk: boolean;
  isLegacy: boolean;
  warnings: string[];
}

export class DeviceProfiler {
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Profile a connected device — read DIS and discover services
   */
  async profileDevice(btDevice: BluetoothDevice): Promise<DeviceProfile> {
    const profile: DeviceProfile = {
      deviceId: btDevice.id,
      deviceName: btDevice.name || 'Unknown',
      primaryServices: [],
      firmwareOk: false,
      isLegacy: false,
      warnings: [],
    };

    this.logger.info('diagnostics', `=== Profiling device: ${profile.deviceName} (${profile.deviceId}) ===`);

    if (!btDevice.gatt?.connected) {
      this.logger.error('diagnostics', 'Device not connected, cannot profile');
      profile.warnings.push('Device not connected');
      return profile;
    }

    // 1. Discover all primary services
    try {
      this.logger.debug('diagnostics', 'Discovering primary services...');
      const services = await btDevice.gatt.getPrimaryServices();
      profile.primaryServices = services.map((s) => s.uuid);
      this.logger.info('diagnostics', `Found ${services.length} primary service(s)`, { services: profile.primaryServices });
    } catch (e) {
      this.logger.error('diagnostics', `Failed to discover services: ${e instanceof Error ? e.message : String(e)}`);
      profile.warnings.push('Service discovery failed');
    }

    // 2. Read Device Information Service
    try {
      const disService = await btDevice.gatt.getPrimaryService(DIS_SERVICE_UUID);
      this.logger.success('diagnostics', 'Device Information Service found');

      for (const [name, uuid] of Object.entries(DIS_CHARACTERISTICS)) {
        try {
          const char = await disService.getCharacteristic(uuid);
          const value = await char.readValue();
          const text = this.decodeString(value);
          (profile as any)[name] = text;
          this.logger.info('diagnostics', `  ${name}: ${text}`);
        } catch (e) {
          this.logger.debug('diagnostics', `  ${name}: not available`);
        }
      }
    } catch (e) {
      this.logger.warn('diagnostics', 'Device Information Service not found');
      profile.warnings.push('DIS not available — device may use custom service');
    }

    // 3. Analyze firmware
    if (profile.firmwareRevision) {
      const fw = profile.firmwareRevision;
      this.logger.info('diagnostics', `Firmware version: ${fw}`);

      // Parse version string (e.g., "4.8.4" or "v4.6.3")
      const versionMatch = fw.match(/(\d+)\.(\d+)\.(\d+)/);
      if (versionMatch) {
        const [_, major, minor, patch] = versionMatch.map(Number);
        const versionNum = major * 100 + minor * 10 + patch;

        if (versionNum >= 484) {
          profile.firmwareOk = true;
          this.logger.success('diagnostics', 'Firmware 4.8.4+ — supports signal + resistance');
        } else if (versionNum >= 463) {
          profile.firmwareOk = true;
          profile.isLegacy = true;
          this.logger.warn('diagnostics', 'Firmware 4.6.3 — legacy, no signal+resistance');
        } else {
          profile.firmwareOk = false;
          profile.warnings.push(`Firmware ${fw} may be unsupported (recommended: 4.8.4)`);
          this.logger.error('diagnostics', `Firmware ${fw} — may be unsupported`);
        }
      } else {
        profile.warnings.push(`Cannot parse firmware version: ${fw}`);
      }
    } else {
      profile.warnings.push('Firmware version unknown');
    }

    // 4. Check for Neiry vs BrainBit UUIDs
    const hasNeiryService = profile.primaryServices.some(
      (u) => u.toLowerCase().includes('cca95') || u.toLowerCase().includes('cca96')
    );
    const hasBrainBitService = profile.primaryServices.some(
      (u) => u.toLowerCase().includes('cca9e')
    );

    if (hasNeiryService && hasBrainBitService) {
      profile.warnings.push('Device advertises BOTH Neiry and BrainBit services — unusual');
    } else if (hasBrainBitService && !hasNeiryService) {
      profile.warnings.push('Device uses BrainBit UUID — may need BrainBit protocol');
    } else if (!hasNeiryService && !hasBrainBitService) {
      profile.warnings.push('Neither Neiry nor BrainBit service found — unknown device');
    }

    // 5. Summary
    this.logger.section(`Device Profile: ${profile.deviceName}`);
    this.logger.md(`- **ID**: ${profile.deviceId}`);
    this.logger.md(`- **Name**: ${profile.deviceName}`);
    this.logger.md(`- **Firmware**: ${profile.firmwareRevision || 'unknown'} ${profile.firmwareOk ? '✅' : '⚠️'}`);
    this.logger.md(`- **Hardware**: ${profile.hardwareRevision || 'unknown'}`);
    this.logger.md(`- **Model**: ${profile.modelNumber || 'unknown'}`);
    this.logger.md(`- **Manufacturer**: ${profile.manufacturerName || 'unknown'}`);
    this.logger.md(`- **Services**: ${profile.primaryServices.length} found`);
    this.logger.md(`- **Warnings**: ${profile.warnings.length > 0 ? profile.warnings.join(', ') : 'none'}`);

    return profile;
  }

  /**
   * Quick check — just firmware version
   */
  async getFirmwareVersion(btDevice: BluetoothDevice): Promise<string | null> {
    try {
      if (!btDevice.gatt?.connected) return null;
      const disService = await btDevice.gatt.getPrimaryService(DIS_SERVICE_UUID);
      const char = await disService.getCharacteristic(DIS_CHARACTERISTICS.firmwareRevision);
      const value = await char.readValue();
      return this.decodeString(value);
    } catch {
      return null;
    }
  }

  private decodeString(dataView: DataView): string {
    const bytes = new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength);
    // Try UTF-8 first
    try {
      return new TextDecoder('utf-8').decode(bytes).replace(/\0/g, '');
    } catch {
      // Fallback: read as ASCII
      return String.fromCharCode(...bytes).replace(/\0/g, '');
    }
  }
}
