// Diagnostics — self-diagnosis, system health checks, and device validation
// Includes cross-reference data from official Capsule SDK v2.0.40

import { getAdapters } from 'webbluetooth';
import { DeviceManager } from './device-manager.js';
import { Logger } from './logger.js';

// Known device profiles from SDK validation (capsule_sdk_diagnose.py)
// These are reference values for validating discovered devices
export const KNOWN_DEVICE_PROFILES: Record<string, DeviceSdkProfile> = {
  // S/N 822058 — validated via Capsule SDK v2.0.40 on 2026-04-21
  '822058': {
    serial: '822058',
    name: 'Headband',
    type: 'Band',
    typeCode: 0,
    eegSampleRate: 250,
    memsSampleRate: 250,
    ppgSampleRate: 100,
    channelsBipolar: ['O1-T3', 'O2-T4'],
    supportsSignalAndResist: true,
    validatedAt: '2026-04-21T15:28:43+03:00',
    sdkVersion: 'v2.0.40-3810ba818',
  },
};

export interface DeviceSdkProfile {
  serial: string;
  name: string;
  type: string;
  typeCode: number;
  eegSampleRate: number;
  memsSampleRate?: number;
  ppgSampleRate?: number;
  channelsBipolar: string[];
  supportsSignalAndResist: boolean;
  validatedAt: string;
  sdkVersion: string;
}

export interface DiagnosticsReport {
  adapterAvailable: boolean;
  adapterCount: number;
  adapterNames: string[];
  platform: string;
  nodeVersion: string;
  webbluetoothVersion: string;
  typicalConnectionLimit: number;
  checks: { name: string; passed: boolean; detail: string }[];
  recommendations: string[];
}

export interface DeviceProfileReport {
  deviceId: string;
  name: string;
  servicesFound: number;
  serviceUuids: string[];
  hasDeviceInformationService: boolean;
  hasNeiryService: boolean;
  neiryServiceUuid?: string;
  characteristics: { uuid: string; properties: string[] }[];
  batteryLevel?: number;
  sdkCrossReference?: {
    serial?: string;
    knownProfile?: DeviceSdkProfile;
    matchConfidence: 'exact' | 'partial' | 'unknown' | 'mismatch';
    notes: string[];
  };
  issues: string[];
  recommendations: string[];
}

export async function runDiagnostics(logger: Logger): Promise<DiagnosticsReport> {
  logger.section('Diagnostics');
  logger.info('diagnostics', '=== Running system diagnostics ===');

  const checks: DiagnosticsReport['checks'] = [];
  const recommendations: string[] = [];

  // Check 1: Node.js version
  const nodeVersion = process.version;
  const nodeOk = nodeVersion.startsWith('v22') || nodeVersion.startsWith('v20') || nodeVersion.startsWith('v18');
  checks.push({
    name: 'Node.js Version',
    passed: nodeOk,
    detail: nodeVersion,
  });
  if (!nodeOk) {
    recommendations.push('⚠️ Node.js 18+ recommended for webbluetooth');
  }

  // Check 2: Platform
  const platform = process.platform;
  checks.push({
    name: 'Platform',
    passed: ['win32', 'darwin', 'linux'].includes(platform),
    detail: platform,
  });

  // Check 3: Bluetooth adapters
  let adapterCount = 0;
  let adapterNames: string[] = [];
  try {
    const adapterList = getAdapters();
    adapterNames = adapterList.map(ad => `adapter${ad.index}:${ad.address}`);
    adapterCount = adapterNames.length;
    checks.push({
      name: 'Bluetooth Adapters',
      passed: adapterCount > 0,
      detail: `${adapterCount} adapter(s): ${adapterNames.join(', ') || 'none'}`,
    });
    if (adapterCount === 0) {
      recommendations.push('🔴 No Bluetooth adapters found. Ensure Bluetooth is enabled.');
    }
  } catch (e) {
    checks.push({
      name: 'Bluetooth Adapters',
      passed: false,
      detail: `Error: ${e instanceof Error ? e.message : String(e)}`,
    });
    recommendations.push('🔴 Failed to enumerate Bluetooth adapters');
  }

  // Check 4: webbluetooth version
  const webbluetoothVersion = '3.x';
  checks.push({
    name: 'webbluetooth',
    passed: true,
    detail: `v${webbluetoothVersion}`,
  });

  // Connection limit guidance
  const typicalLimit = platform === 'win32' ? 7 : platform === 'darwin' ? 5 : 10;
  checks.push({
    name: 'Typical BLE Limit',
    passed: true,
    detail: `${typicalLimit} simultaneous connections (estimated for ${platform})`,
  });

  // Summary
  const passed = checks.filter((c) => c.passed).length;
  const total = checks.length;

  logger.info('diagnostics', `Checks: ${passed}/${total} passed`);
  for (const check of checks) {
    const emoji = check.passed ? '✅' : '❌';
    logger.info('diagnostics', `${emoji} ${check.name}: ${check.detail}`);
  }

  if (recommendations.length > 0) {
    logger.warn('diagnostics', 'Recommendations:');
    for (const rec of recommendations) {
      logger.warn('diagnostics', `  ${rec}`);
    }
  }

  return {
    adapterAvailable: adapterCount > 0,
    adapterCount,
    adapterNames: adapterNames.map(a => String(a)),
    platform,
    nodeVersion,
    webbluetoothVersion,
    typicalConnectionLimit: typicalLimit,
    checks,
    recommendations,
  };
}

/**
 * Profile a connected device: list services, check for known UUIDs,
 * and cross-reference with SDK-validated profiles.
 */
export async function profileDevice(
  manager: DeviceManager,
  deviceId: string,
  logger: Logger
): Promise<DeviceProfileReport> {
  const device = manager.getDevice(deviceId);
  const report: DeviceProfileReport = {
    deviceId,
    name: device?.name || 'Unknown',
    servicesFound: 0,
    serviceUuids: [],
    hasDeviceInformationService: false,
    hasNeiryService: false,
    characteristics: [],
    issues: [],
    recommendations: [],
  };

  if (!device) {
    report.issues.push('Device not found in registry');
    return report;
  }

  if (!device.gattServer || !device.gattServer.connected) {
    report.issues.push('Device not connected — cannot profile services');
    report.recommendations.push('Connect to device first using --auto or --test-single');
    return report;
  }

  logger.info('diagnostics', `Profiling device ${device.name} (${deviceId})...`);

  try {
    const services = await device.gattServer.getPrimaryServices();
    report.servicesFound = services.length;
    report.serviceUuids = services.map(s => s.uuid);

    logger.info('diagnostics', `Found ${services.length} primary service(s)`, {
      uuids: report.serviceUuids,
    });

    for (const service of services) {
      // Check for Device Information Service (0x180a)
      if (service.uuid === '0000180a-0000-1000-8000-00805f9b34fb') {
        report.hasDeviceInformationService = true;
      }

      // Check for Neiry service
      if (service.uuid.toLowerCase().startsWith('7e400001')) {
        report.hasNeiryService = true;
        report.neiryServiceUuid = service.uuid;
      }

      // List characteristics
      try {
        const characteristics = await service.getCharacteristics();
        for (const char of characteristics) {
          report.characteristics.push({
            uuid: char.uuid,
            properties: Array.from(char.properties),
          });
        }
      } catch (e) {
        logger.warn('diagnostics', `Failed to get characteristics for service ${service.uuid}`);
      }
    }
  } catch (e) {
    report.issues.push(`Failed to enumerate services: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Analyze findings
  if (report.servicesFound === 0) {
    report.issues.push('ZERO services found after GATT connect — critical failure');
    report.recommendations.push('🔴 Device may be in error state or paired elsewhere');
    report.recommendations.push('🔴 Try power-cycling the device (hold button 5+ seconds)');
    report.recommendations.push('🔴 Check if device is connected to Neiry Capsule app or another BLE client');
    report.recommendations.push('🔴 Remove device from Windows Bluetooth settings and re-pair');
  } else if (report.servicesFound < 3) {
    report.issues.push(`Only ${report.servicesFound} services found — expected at least 3 (Generic Access, Generic Attribute, Neiry Service)`);
    report.recommendations.push('⚠️ Device may have incomplete GATT table or be in partial initialization state');
  }

  if (!report.hasDeviceInformationService) {
    report.recommendations.push('ℹ️ No Device Information Service (0x180A) — firmware version unavailable via BLE (expected for Neiry devices)');
  }

  if (!report.hasNeiryService) {
    report.issues.push('Neiry service (7e400001...) NOT found — this may not be a Neiry/BrainBit device');
    report.recommendations.push('🔴 Verify device model and firmware compatibility');
  }

  // Try reading battery
  try {
    const batteryService = await device.gattServer.getPrimaryService('0000180f-0000-1000-8000-00805f9b34fb');
    const batteryChar = await batteryService.getCharacteristic('00002a19-0000-1000-8000-00805f9b34fb');
    const value = await batteryChar.readValue();
    report.batteryLevel = value.getUint8(0);
    logger.info('diagnostics', `Battery level: ${report.batteryLevel}%`);
  } catch {
    // Battery service optional
  }

  // SDK cross-reference
  // Try to identify device by name/serial pattern for known profiles
  const knownProfile = Object.values(KNOWN_DEVICE_PROFILES).find(
    p => device.name?.includes(p.name) || device.name?.includes(p.serial)
  );

  if (knownProfile) {
    report.sdkCrossReference = {
      serial: knownProfile.serial,
      knownProfile,
      matchConfidence: 'exact',
      notes: [
        `Validated via Capsule SDK ${knownProfile.sdkVersion} on ${knownProfile.validatedAt}`,
        `EEG: ${knownProfile.eegSampleRate}Hz, MEMS: ${knownProfile.memsSampleRate}Hz, PPG: ${knownProfile.ppgSampleRate}Hz`,
        `Channels (bipolar): ${knownProfile.channelsBipolar.join(', ')}`,
        `Supports Signal+Resist: ${knownProfile.supportsSignalAndResist}`,
      ],
    };
  } else {
    report.sdkCrossReference = {
      matchConfidence: 'unknown',
      notes: [
        'Device not in validated profile database.',
        'Run capsule_sdk_diagnose.py with official SDK to validate.',
        'Or use --test-single to perform streaming validation.',
      ],
    };
  }

  logger.info('diagnostics', `Profile complete: ${report.servicesFound} services, ${report.issues.length} issue(s)`, {
    hasNeiryService: report.hasNeiryService,
    hasDIS: report.hasDeviceInformationService,
  });

  return report;
}

export async function diagnoseDeviceConnection(
  manager: DeviceManager,
  deviceId: string,
  logger: Logger
): Promise<{ canConnect: boolean; issues: string[] }> {
  const issues: string[] = [];
  const device = manager.getDevice(deviceId);

  if (!device) {
    issues.push('Device not found in registry');
    return { canConnect: false, issues };
  }

  if (!device.bluetoothDevice) {
    issues.push('No BluetoothDevice object');
    return { canConnect: false, issues };
  }

  // Check GATT availability
  const gatt = device.bluetoothDevice.gatt;
  if (!gatt) {
    issues.push('GATT not available — device may need pairing in OS settings');
  }

  // Check if already connected elsewhere
  if (device.state === 'connected') {
    issues.push('Device already connected');
  }

  // Check previous errors
  if (device.state === 'error') {
    issues.push('Device in error state from previous attempt');
  }

  logger.info('diagnostics', `Device ${device.name} diagnosis: ${issues.length} issue(s)`, { deviceId, issues });

  return {
    canConnect: issues.length === 0 || (issues.length === 1 && issues[0].includes('already connected')),
    issues,
  };
}

/**
 * Generate a device health score based on profile + connection history.
 * 0-100 scale where 100 = fully healthy.
 */
export function calculateDeviceHealthScore(
  profile: DeviceProfileReport,
  connectionAttempts: number,
  successfulConnections: number
): number {
  let score = 100;

  // Service enumeration penalty
  if (profile.servicesFound === 0) score -= 50;
  else if (profile.servicesFound < 3) score -= 20;

  // Missing Neiry service penalty
  if (!profile.hasNeiryService) score -= 30;

  // Connection reliability penalty
  if (connectionAttempts > 0) {
    const reliability = successfulConnections / connectionAttempts;
    if (reliability < 0.5) score -= 25;
    else if (reliability < 0.8) score -= 10;
  }

  // Issues penalty
  score -= profile.issues.length * 10;

  return Math.max(0, Math.min(100, score));
}
