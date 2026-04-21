#!/usr/bin/env node
// Neiry CLI — console application for multi-device EEG collection

import { Bluetooth } from 'webbluetooth';
import { Logger, resetLogger } from './logger.js';
import { DeviceManager } from './device-manager.js';
import { ConnectionOrchestrator } from './connection-orchestrator.js';
import { EEGCollector } from './eeg-collector.js';
import { runDiagnostics, profileDevice, calculateDeviceHealthScore, KNOWN_DEVICE_PROFILES } from './diagnostics.js';
import { DeviceProfiler } from './device-profiler.js';
import { ConnectionHistory } from './connection-history.js';
import { mergeConfig, type AppConfig } from './config.js';
import { mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const HELP = `
Neiry CLI — Multi-device EEG collector

Usage:
  npx tsx cli/src/index.ts [options]

Options:
  --auto                    Auto-discover and connect all devices
  --max-devices <n>         Max devices to connect (default: 4)
  --duration <seconds>      Collection duration in seconds (default: 60)
  --scan-time <seconds>     Scan duration (default: 15)
  --output <dir>            Output directory for data
  --diagnose                Run system diagnostics only
  --diagnose-device         Profile device with SDK cross-reference & health score
  --test-single             Test connect → validate → stream → stop one device
  --ble-scan                Scan and show advertised BLE services
  --sdk-compare             Compare BLE scan against SDK-validated profiles
  --history                 Show connection history for all devices
  --history-device <id>     Show history for specific device
  --verbose                 Enable debug logging
  --help                    Show this help

Examples:
  npx tsx cli/src/index.ts --auto --max-devices 3 --duration 300
  npx tsx cli/src/index.ts --diagnose --verbose
  npx tsx cli/src/index.ts --diagnose-device --scan-time 30
  npx tsx cli/src/index.ts --test-single
`;

function parseArgs(): { command: string; config: Partial<AppConfig>; duration: number; verbose: boolean; historyDeviceId?: string } {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(HELP);
    process.exit(0);
  }

  const config: Partial<AppConfig> = {};
  let duration = 60;
  let verbose = false;
  let command = 'help';

  if (args.includes('--auto')) command = 'auto';
  if (args.includes('--diagnose')) command = 'diagnose';
  if (args.includes('--diagnose-device')) command = 'diagnose-device';
  if (args.includes('--test-single')) command = 'test-single';
  if (args.includes('--ble-scan')) command = 'ble-scan';
  if (args.includes('--sdk-compare')) command = 'sdk-compare';
  if (args.includes('--history')) command = 'history';
  if (args.includes('--history-device')) command = 'history-device';

  let historyDeviceId: string | undefined;
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--max-devices':
        config.maxDevices = parseInt(args[++i], 10);
        break;
      case '--duration':
        duration = parseInt(args[++i], 10);
        break;
      case '--scan-time':
        config.scanTime = parseInt(args[++i], 10);
        break;
      case '--output':
        config.outputDir = args[++i];
        break;
      case '--history-device':
        historyDeviceId = args[++i];
        break;
      case '--verbose':
        verbose = true;
        config.logLevel = 'debug';
        break;
    }
  }

  return { command, config, duration, verbose, historyDeviceId };
}

async function main() {
  const { command, config: userConfig, duration, verbose, historyDeviceId } = parseArgs();

  if (command === 'help') {
    console.log(HELP);
    process.exit(0);
  }

  // Setup directories
  const cfg = mergeConfig(userConfig);
  if (!existsSync(cfg.outputDir)) mkdirSync(cfg.outputDir, { recursive: true });
  if (!existsSync(cfg.logDir)) mkdirSync(cfg.logDir, { recursive: true });

  // Initialize logger
  resetLogger();
  const logger = new Logger({
    logDir: cfg.logDir,
    consoleLevel: verbose ? 'debug' : cfg.logLevel,
    fileLevel: 'debug',
    enableJson: true,
    enableMarkdown: true,
  });

  logger.info('init', '=== Neiry CLI started ===', {
    command,
    duration,
    config: cfg,
    nodeVersion: process.version,
    platform: process.platform,
  });

  // Diagnostics mode
  if (command === 'diagnose') {
    await runDiagnostics(logger);
    logger.finalize();
    process.exit(0);
  }

  // Diagnose-device mode: scan, connect, and profile one device with SDK cross-ref
  if (command === 'diagnose-device') {
    logger.info('init', '=== Device Diagnostics Mode (with SDK cross-reference) ===');
    const manager = new DeviceManager(logger, cfg);

    logger.info('discovery', 'Scanning for a device to profile...');
    const devices = await manager.scan();
    if (devices.length === 0) {
      logger.error('discovery', 'No devices found');
      logger.finalize();
      process.exit(1);
    }

    const device = devices[0];
    logger.info('discovery', `Selected: ${device.name} (${device.id})`);

    // Connect
    const connected = await manager.connect(device.id);
    if (!connected) {
      logger.error('connection', 'Failed to connect');
      logger.info('report', 'Troubleshooting:');
      logger.info('report', '  1. Device may be paired elsewhere — check Windows Bluetooth settings');
      logger.info('report', '  2. Power-cycle the device (hold button 5+ seconds)');
      logger.info('report', '  3. Run official Capsule app to verify device health');
      logger.finalize();
      process.exit(1);
    }

    // Profile with new diagnostics module
    const profile = await profileDevice(manager, device.id, logger);

    // Print summary
    logger.section('Device Profile Summary');
    logger.info('profile', `Name: ${profile.name}`);
    logger.info('profile', `Services found: ${profile.servicesFound}`);
    logger.info('profile', `Service UUIDs: ${profile.serviceUuids.join(', ') || 'none'}`);
    logger.info('profile', `Has Neiry service: ${profile.hasNeiryService}`);
    logger.info('profile', `Has DIS (0x180A): ${profile.hasDeviceInformationService}`);
    if (profile.batteryLevel !== undefined) {
      logger.info('profile', `Battery: ${profile.batteryLevel}%`);
    }

    if (profile.sdkCrossReference) {
      logger.section('SDK Cross-Reference');
      logger.info('sdk', `Match confidence: ${profile.sdkCrossReference.matchConfidence}`);
      for (const note of profile.sdkCrossReference.notes) {
        logger.info('sdk', `  ${note}`);
      }
      if (profile.sdkCrossReference.knownProfile) {
        const p = profile.sdkCrossReference.knownProfile;
        logger.info('sdk', `Validated EEG rate: ${p.eegSampleRate}Hz`);
        logger.info('sdk', `Validated channels: ${p.channelsBipolar.join(', ')}`);
      }
    }

    if (profile.issues.length > 0) {
      logger.section('Issues Found');
      for (const issue of profile.issues) {
        logger.error('profile', `  ⚠️ ${issue}`);
      }
    }

    if (profile.recommendations.length > 0) {
      logger.section('Recommendations');
      for (const rec of profile.recommendations) {
        logger.info('profile', `  ${rec}`);
      }
    }

    // Health score
    const healthScore = calculateDeviceHealthScore(profile, 1, connected ? 1 : 0);
    logger.section('Health Score');
    const healthEmoji = healthScore >= 80 ? '✅' : healthScore >= 50 ? '⚠️' : '🔴';
    logger.info('profile', `${healthEmoji} Device health: ${healthScore}/100`);

    // Disconnect
    await manager.disconnect(device.id);

    logger.finalize();
    process.exit(profile.issues.length > 0 ? 1 : 0);
  }

  // Test-single mode: connect one device, validate, start streaming, stop
  if (command === 'test-single') {
    logger.info('init', '=== Single Device Test Mode ===');
    const manager = new DeviceManager(logger, cfg);

    logger.info('discovery', 'Scanning for a device...');
    const devices = await manager.scan();
    if (devices.length === 0) {
      logger.error('discovery', 'No devices found');
      logger.finalize();
      process.exit(1);
    }

    const device = devices[0];
    logger.info('discovery', `Selected: ${device.name} (${device.id})`);

    // Connect
    logger.info('connection', 'Connecting...');
    const connected = await manager.connect(device.id);
    if (!connected) {
      logger.error('connection', 'Failed to connect');
      logger.finalize();
      process.exit(1);
    }

    // Profile with SDK cross-reference
    const profile = await profileDevice(manager, device.id, logger);
    logger.info('profile', `Services: ${profile.servicesFound}, Neiry service: ${profile.hasNeiryService}`);

    // Validate protocol
    logger.info('validation', 'Validating protocol...');
    const validation = await manager.validateProtocol(device.id);
    logger.info('validation', `Service found: ${validation.serviceFound}`);
    logger.info('validation', `Characteristics: ${JSON.stringify(validation.characteristicsFound)}`);

    // Start streaming
    logger.info('streaming', 'Starting EEG stream...');
    const streaming = await manager.startSignal(device.id);
    if (streaming) {
      logger.success('streaming', 'EEG streaming started!');
      logger.info('streaming', 'Collecting for 10 seconds...');
      await new Promise((r) => setTimeout(r, 10000));

      logger.info('streaming', 'Stopping...');
      await manager.stopSignal(device.id);
    } else {
      logger.error('streaming', 'Failed to start streaming');
    }

    // Disconnect
    await manager.disconnect(device.id);

    logger.finalize();
    process.exit(streaming ? 0 : 1);
  }

  // SDK-compare mode: show SDK profiles vs BLE scan results
  if (command === 'sdk-compare') {
    logger.info('init', '=== SDK Profile Comparison ===');
    logger.info('sdk', 'SDK-validated device profiles:');
    
    for (const [serial, profile] of Object.entries(KNOWN_DEVICE_PROFILES)) {
      logger.info('sdk', `  [${serial}] ${profile.name} (${profile.type})`);
      logger.info('sdk', `    EEG: ${profile.eegSampleRate}Hz, MEMS: ${profile.memsSampleRate}Hz, PPG: ${profile.ppgSampleRate}Hz`);
      logger.info('sdk', `    Channels: ${profile.channelsBipolar.join(', ')}`);
      logger.info('sdk', `    Signal+Resist: ${profile.supportsSignalAndResist}`);
      logger.info('sdk', `    Validated: ${profile.validatedAt}`);
    }

    logger.info('sdk', '');
    logger.info('sdk', 'Now scanning for BLE devices to compare...');
    
    const manager = new DeviceManager(logger, cfg);
    const devices = await manager.scan();
    
    if (devices.length === 0) {
      logger.warn('sdk', 'No BLE devices found during scan');
    } else {
      logger.info('sdk', `Found ${devices.length} BLE device(s):`);
      for (const d of devices) {
        const known = Object.values(KNOWN_DEVICE_PROFILES).find(
          p => d.name?.includes(p.name) || d.name?.includes(p.serial)
        );
        if (known) {
          logger.success('sdk', `  ✅ ${d.name} (${d.id}) — MATCHES SDK profile ${known.serial}`);
        } else {
          logger.warn('sdk', `  ⚠️ ${d.name} (${d.id}) — UNKNOWN device, not in SDK database`);
        }
      }
    }

    logger.finalize();
    process.exit(0);
  }

  // History mode: show connection history for all or specific device
  if (command === 'history' || command === 'history-device') {
    const history = new ConnectionHistory(cfg.logDir);
    const targetId = historyDeviceId;

    if (targetId) {
      // Specific device
      const summary = history.getDeviceSummary(targetId);
      if (!summary) {
        logger.warn('report', `No history found for device ${targetId}`);
      } else {
        logger.section(`History: ${summary.deviceName} (${targetId})`);
        logger.info('report', `Total connections: ${summary.totalConnections} (${summary.successfulConnections} OK, ${summary.failedConnections} fail)`);
        logger.info('report', `Stream sessions: ${summary.totalStreamSessions}`);
        logger.info('report', `Total samples: ${summary.totalSamplesReceived}`);
        logger.info('report', `Avg connect time: ${summary.averageConnectTimeMs}ms`);
        logger.info('report', `Last seen: ${summary.lastSeen}`);
        if (summary.lastBatteryLevel !== undefined) {
          logger.info('report', `Last battery: ${summary.lastBatteryLevel}%`);
        }
        logger.info('report', `Health trend: ${summary.healthTrend}`);
        if (summary.failurePatterns.length > 0) {
          logger.info('report', 'Failure patterns:');
          for (const fp of summary.failurePatterns) {
            logger.warn('report', `  ${fp.code}: ${fp.count}x`);
          }
        }
        logger.info('report', '');
        logger.info('report', 'Recent events:');
        const recent = history.getRecentEvents(targetId, 10);
        for (const ev of recent) {
          const emoji = { scan: '🔍', connect_attempt: '🔗', connect_success: '✅', connect_fail: '❌',
                         disconnect: '🛑', stream_start: '▶️', stream_stop: '⏹️', stream_data: '📊',
                         error: '⚠️', profile: '🔬' }[ev.event] || '•';
          logger.info('report', `  ${emoji} ${ev.ts.slice(11,19)} ${ev.event}${ev.errorCode ? ` [${ev.errorCode}]` : ''}${ev.notes ? `: ${ev.notes}` : ''}`);
        }
      }
    } else {
      // All devices
      const summaries = history.getAllSummaries();
      if (summaries.length === 0) {
        logger.warn('report', 'No connection history found');
      } else {
        logger.section('Connection History Summary');
        for (const s of summaries) {
          const trendEmoji = { improving: '📈', stable: '➡️', degrading: '📉', unknown: '❓' }[s.healthTrend];
          const healthPct = s.totalConnections > 0 ? Math.round((s.successfulConnections / s.totalConnections) * 100) : 0;
          logger.info('report', `${trendEmoji} ${s.deviceName} (${s.deviceId}): ${s.successfulConnections}/${s.totalConnections} OK (${healthPct}%), ${s.totalStreamSessions} streams, last ${s.lastSeen.slice(0,10)}`);
        }
      }
    }

    logger.finalize();
    process.exit(0);
  }

  // Auto mode
  if (command === 'auto') {
    const sessionDir = join(cfg.outputDir, `session_${Date.now()}`);
    mkdirSync(sessionDir, { recursive: true });

    // Initialize components
    const collector = new EEGCollector(logger, cfg, sessionDir);
    const manager = new DeviceManager(logger, cfg, {
      onDeviceDiscovered: (d) => {
        logger.info('discovery', `Discovered: ${d.name} (${d.deviceType})`, { deviceId: d.id });
      },
      onDeviceConnected: (d) => {
        logger.success('connection', `${d.name} connected`, { deviceId: d.id, battery: d.batteryLevel });
      },
      onDeviceDisconnected: (d) => {
        logger.warn('connection', `${d.name} disconnected`, { deviceId: d.id });
      },
      onDeviceError: (d, err) => {
        logger.error('connection', `${d.name} error: ${err}`, { deviceId: d.id });
      },
      onEEGData: (d, packet) => {
        if (!packet) return;
        const points = Object.entries(packet.samples).map(([channel, value]) => ({
          timestamp: packet.timestamp,
          channel,
          value,
        }));
        collector.addPoints(d.id, d.name, points);
      },
      onNotifyRaw: (d, hex, bytes) => {
        logger.rx('streaming', `[${d.name}] ${hex} (${bytes}b)`, { deviceId: d.id });
      },
    });

    const orchestrator = new ConnectionOrchestrator(manager, logger, cfg);

    // Start collection
    await collector.start();

    // Run auto-connect
    const report = await orchestrator.runAuto(cfg.maxDevices);

    // If no devices connected, exit
    if (report.connected === 0) {
      logger.error('report', 'No devices connected. Cannot collect data.');
      logger.section('Troubleshooting');
      logger.info('report', '1. Ensure devices are powered on and in range');
      logger.info('report', '2. Check Bluetooth is enabled');
      logger.info('report', '3. Run: npx tsx cli/src/index.ts --diagnose --verbose');
      collector.stop();
      logger.finalize();
      process.exit(1);
    }

    // Collect data for specified duration
    logger.info('streaming', `Collecting EEG data for ${duration} seconds...`);
    logger.info('streaming', `Output: ${sessionDir}`);

    await new Promise((resolve) => setTimeout(resolve, duration * 1000));

    // Shutdown
    await orchestrator.shutdown();
    collector.stop();

    // Final report
    logger.section('Collection Summary');
    logger.info('report', `Session directory: ${sessionDir}`);
    logger.info('report', `Devices discovered: ${report.discovered}`);
    logger.info('report', `Devices connected: ${report.connected}`);
    logger.info('report', `Devices streaming: ${report.streaming}`);

    const stats = collector.getStats();
    for (const stat of stats) {
      logger.info('report', `  ${stat.deviceId}: ${stat.rowCount} rows → ${stat.filePath}`);
    }

    for (const rec of report.recommendations) {
      logger.info('report', rec);
    }

    logger.finalize();
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
