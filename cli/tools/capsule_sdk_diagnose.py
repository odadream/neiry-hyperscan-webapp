#!/usr/bin/env python3
"""
Capsule SDK Diagnostic Tool
===========================
Uses the official Neiry Capsule SDK (v2.0.40) to validate BLE devices
and compare behavior against our custom webbluetooth implementation.

This script:
1. Discovers devices via official SDK (not BLE scan)
2. Connects to each device and retrieves firmware info
3. Tests signal streaming briefly
4. Generates a comparison report with our BLE findings

Usage:
    cd cli/tools
    python capsule_sdk_diagnose.py

Requirements:
    - Python 3.11+
    - CapsuleClient.dll in Capsule v2.0.40 directory
    - numpy (optional, for data validation)
"""

import sys
import os
import time
import json
from datetime import datetime
from dataclasses import dataclass, asdict
from typing import List, Optional, Callable
from enum import IntEnum

# ---------------------------------------------------------------------------
# Add Capsule SDK Python wrapper to path
# ---------------------------------------------------------------------------
CAPSULE_SDK_PATH = r"D:\YandexDisk\_ODA2\Software\LAB Neiry\Capsule v2.0.40\CapsuleAPI\Windows\Capsule Python\CapsuleClientPython"
CAPSULE_DLL_PATH = r"D:\YandexDisk\_ODA2\Software\LAB Neiry\Capsule v2.0.40\CapsuleAPI\Windows\Lib\CapsuleClient.dll"

sys.path.insert(0, CAPSULE_SDK_PATH)

# ---------------------------------------------------------------------------
# SDK Imports
# ---------------------------------------------------------------------------
from Capsule import Capsule
from DeviceLocator import DeviceLocator
from DeviceType import DeviceType
from DeviceInfo import DeviceInfo
from Device import Device, Device_Connection_Status, Device_Mode
from Error import Error, Error_Code, CapsuleException

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
DEVICE_TYPE = DeviceType.Band  # Headband = 0
SCAN_TIMEOUT_SEC = 15
CONNECT_TIMEOUT_SEC = 30
STREAM_TEST_DURATION_SEC = 5
REPORT_DIR = os.path.join(os.path.dirname(__file__), "..", "logs")

# Known MAC addresses from our BLE scans (for cross-reference)
KNOWN_BLE_MACS = {
    "fc:e3:27:df:34:61": "Device A (working intermittently)",
    "c0:33:3e:e4:e5:1c": "Device B (0 services after connect)",
}

# ---------------------------------------------------------------------------
# Data Structures
# ---------------------------------------------------------------------------

class TestResult(IntEnum):
    PASS = 0
    FAIL = 1
    SKIP = 2
    TIMEOUT = 3

@dataclass
class DeviceDiagnosticReport:
    timestamp: str
    sdk_version: str
    device_serial: str
    device_name: str
    device_type: str
    device_type_code: int
    
    # Discovery
    discovery_found: bool
    discovery_time_ms: int
    
    # Connection
    connection_attempted: bool
    connection_status: Optional[int]
    connection_status_name: str
    connection_time_ms: int
    connection_error: Optional[str]
    
    # Device Info
    info_name: Optional[str]
    info_serial: Optional[str]
    info_type: Optional[int]
    info_type_name: Optional[str]
    
    # Capabilities
    eeg_sample_rate: Optional[float]
    mems_sample_rate: Optional[float]
    ppg_sample_rate: Optional[float]
    ppg_ir_amplitude: Optional[int]
    ppg_red_amplitude: Optional[int]
    channel_names: List[str]
    battery_charge: Optional[int]
    
    # Streaming Test
    stream_test_attempted: bool
    stream_test_passed: bool
    stream_samples_received: int
    stream_test_duration_ms: int
    stream_test_error: Optional[str]
    
    # Mode after start
    device_mode: Optional[int]
    device_mode_name: Optional[str]
    
    # Cross-reference
    ble_mac_guess: Optional[str]
    ble_services_count: Optional[int]
    ble_dis_present: Optional[bool]
    
    # Overall
    overall_result: str
    failure_reason: Optional[str]

@dataclass
class SystemReport:
    timestamp: str
    sdk_version: str
    sdk_dll_path: str
    sdk_dll_exists: bool
    python_version: str
    scan_timeout_sec: int
    connect_timeout_sec: int
    devices_tested: int
    devices_passed: int
    devices_failed: int
    device_reports: List[dict]

# ---------------------------------------------------------------------------
# Event State Helper
# ---------------------------------------------------------------------------

class EventFiredState:
    def __init__(self):
        self._awake = False
        self._data = None
    
    def is_awake(self):
        return self._awake
    
    def set_awake(self, data=None):
        self._awake = True
        self._data = data
    
    def sleep(self):
        self._awake = False
        self._data = None
    
    def get_data(self):
        return self._data


def non_blocking_wait(wake_event: EventFiredState, event_name: str, 
                      total_sleep_time_sec: int, 
                      device_locator: Optional[DeviceLocator] = None,
                      poll_interval_sec: float = 0.02) -> bool:
    """Wait for event with optional device_locator updates."""
    print(f"  [WAIT] {event_name} (max {total_sleep_time_sec}s)...")
    iterations = int(total_sleep_time_sec / poll_interval_sec)
    for _ in range(iterations):
        if device_locator is not None:
            device_locator.update()
        if wake_event.is_awake():
            print(f"  [OK] Event '{event_name}' occurred!")
            return True
        time.sleep(poll_interval_sec)
    print(f"  [TIMEOUT] Waiting for '{event_name}' timed out")
    return False

# ---------------------------------------------------------------------------
# Diagnostic Logic
# ---------------------------------------------------------------------------

def discover_devices(locator: DeviceLocator, device_type: DeviceType, 
                     timeout_sec: int) -> List[DeviceInfo]:
    """Discover devices using Capsule SDK."""
    devices_found: List[DeviceInfo] = []
    discovery_event = EventFiredState()
    
    def on_device_list(locator, info_list, fail_reason):
        count = len(info_list)
        print(f"  [SDK] Found {count} device(s)")
        if count > 0:
            for i in range(count):
                di = info_list[i]
                print(f"    [{i}] Serial: {di.get_serial()}, Name: {di.get_name()}, Type: {di.get_type()}")
                devices_found.append(di)
        discovery_event.set_awake()
    
    locator.set_on_devices_list(on_device_list)
    
    start_time = time.time()
    locator.request_devices(device_type, timeout_sec)
    
    success = non_blocking_wait(discovery_event, "device discovery", timeout_sec + 5, locator)
    elapsed_ms = int((time.time() - start_time) * 1000)
    
    if not success:
        print(f"  [WARN] Discovery timed out after {elapsed_ms}ms")
    
    return devices_found, elapsed_ms


def diagnose_single_device(capsule_lib: Capsule, device_info: DeviceInfo, 
                           locator: DeviceLocator, ble_mac: Optional[str] = None,
                           ble_services: Optional[int] = None,
                           ble_dis: Optional[bool] = None) -> DeviceDiagnosticReport:
    """Run full diagnostic on a single device."""
    
    serial = device_info.get_serial()
    name = device_info.get_name()
    dtype = device_info.get_type()
    dtype_name = {0:"Band",1:"Buds",2:"Headphones",3:"Impulse",4:"Any",6:"BrainBit",100:"SinWave",101:"Noise"}.get(dtype, f"Unknown({dtype})")
    
    print(f"\n{'='*60}")
    print(f"DIAGNOSTIC: {name} (S/N: {serial})")
    print(f"{'='*60}")
    
    report = DeviceDiagnosticReport(
        timestamp=datetime.now().isoformat(),
        sdk_version=capsule_lib.get_version(),
        device_serial=serial,
        device_name=name,
        device_type=dtype_name,
        device_type_code=dtype,
        discovery_found=True,
        discovery_time_ms=0,
        connection_attempted=False,
        connection_status=None,
        connection_status_name="Not attempted",
        connection_time_ms=0,
        connection_error=None,
        info_name=None,
        info_serial=None,
        info_type=None,
        info_type_name=None,
        eeg_sample_rate=None,
        mems_sample_rate=None,
        ppg_sample_rate=None,
        ppg_ir_amplitude=None,
        ppg_red_amplitude=None,
        channel_names=[],
        battery_charge=None,
        stream_test_attempted=False,
        stream_test_passed=False,
        stream_samples_received=0,
        stream_test_duration_ms=0,
        stream_test_error=None,
        device_mode=None,
        device_mode_name=None,
        ble_mac_guess=ble_mac,
        ble_services_count=ble_services,
        ble_dis_present=ble_dis,
        overall_result="PENDING",
        failure_reason=None,
    )
    
    # --- Create Device object ---
    try:
        device = Device(locator, serial, capsule_lib.get_lib())
        print(f"  [OK] Device object created")
    except CapsuleException as e:
        report.connection_error = f"Failed to create Device object: {e}"
        report.overall_result = "FAIL"
        report.failure_reason = report.connection_error
        print(f"  [FAIL] {report.connection_error}")
        return report
    
    # --- Set up callbacks ---
    connection_event = EventFiredState()
    battery_event = EventFiredState()
    eeg_samples = []
    eeg_event = EventFiredState()
    mode_event = EventFiredState()
    error_event = EventFiredState()
    
    def on_connection_status(device, status):
        status_names = {0:"Disconnected", 1:"Connected", 2:"UnsupportedConnection"}
        status_name = status_names.get(int(status), f"Unknown({status})")
        print(f"  [EVENT] Connection status: {status_name}")
        connection_event.set_awake(int(status))
    
    def on_battery(device, charge):
        print(f"  [EVENT] Battery: {charge}%")
        battery_event.set_awake(charge)
    
    def on_eeg(device, eeg):
        count = eeg.get_samples_count()
        eeg_samples.append(count)
        if len(eeg_samples) <= 3:  # Log first few
            print(f"  [EVENT] EEG batch: {count} samples, {eeg.get_channels_count()} channels")
        eeg_event.set_awake()
    
    def on_mode_changed(device, mode):
        mode_names = {0:"Resistance", 1:"Signal", 2:"SignalAndResist", 
                      3:"StartMEMS", 4:"StopMEMS", 5:"StartPPG", 6:"StopPPG"}
        mode_name = mode_names.get(int(mode.value), f"Unknown({mode.value})")
        print(f"  [EVENT] Mode changed: {mode_name}")
        mode_event.set_awake(int(mode.value))
    
    def on_error(device, error_msg):
        print(f"  [EVENT] Device error: {error_msg}")
        error_event.set_awake(str(error_msg))
    
    device.set_on_connection_status_changed(on_connection_status)
    device.set_on_battery_charge_changed(on_battery)
    device.set_on_eeg(on_eeg)
    device.set_on_mode_changed(on_mode_changed)
    device.set_on_error(on_error)
    
    # --- Connect ---
    report.connection_attempted = True
    print(f"\n  [TEST] Connecting (bipolar=True)...")
    conn_start = time.time()
    
    try:
        device.connect(bipolarChannels=True)
        print(f"  [OK] Connect command sent")
    except CapsuleException as e:
        report.connection_error = f"Connect failed: {e}"
        report.connection_time_ms = int((time.time() - conn_start) * 1000)
        report.overall_result = "FAIL"
        report.failure_reason = report.connection_error
        print(f"  [FAIL] {report.connection_error}")
        return report
    
    # Wait for connection
    connected = non_blocking_wait(connection_event, "connection", CONNECT_TIMEOUT_SEC, locator)
    report.connection_time_ms = int((time.time() - conn_start) * 1000)
    
    if not connected:
        report.connection_error = "Connection timeout"
        report.overall_result = "FAIL"
        report.failure_reason = "Device did not connect within timeout"
        print(f"  [FAIL] Connection timeout")
        return report
    
    report.connection_status = connection_event.get_data()
    report.connection_status_name = {0:"Disconnected", 1:"Connected", 2:"UnsupportedConnection"}.get(
        report.connection_status, f"Unknown({report.connection_status})")
    
    if report.connection_status != 1:
        report.connection_error = f"Connection status = {report.connection_status_name}"
        report.overall_result = "FAIL"
        report.failure_reason = report.connection_error
        print(f"  [FAIL] Connection status is not Connected")
        return report
    
    print(f"  [OK] Connected in {report.connection_time_ms}ms")
    
    # --- Get Device Info ---
    try:
        info = device.get_info()
        report.info_name = info.get_name()
        report.info_serial = info.get_serial()
        report.info_type = info.get_type()
        report.info_type_name = {0:"Band",1:"Buds",2:"Headphones",3:"Impulse",4:"Any",6:"BrainBit"}.get(
            report.info_type, f"Unknown({report.info_type})")
        print(f"  [INFO] Name={report.info_name}, Serial={report.info_serial}, Type={report.info_type_name}")
    except CapsuleException as e:
        print(f"  [WARN] get_info failed: {e}")
    
    # --- Get Capabilities ---
    try:
        report.eeg_sample_rate = device.get_eeg_sample_rate()
        print(f"  [CAP] EEG sample rate: {report.eeg_sample_rate} Hz")
    except CapsuleException as e:
        print(f"  [WARN] EEG sample rate unavailable: {e}")
    
    try:
        report.mems_sample_rate = device.get_mems_sample_rate()
        print(f"  [CAP] MEMS sample rate: {report.mems_sample_rate} Hz")
    except CapsuleException as e:
        print(f"  [INFO] MEMS unavailable (expected for some devices): {e}")
    
    try:
        report.ppg_sample_rate = device.get_ppg_sample_rate()
        print(f"  [CAP] PPG sample rate: {report.ppg_sample_rate} Hz")
    except CapsuleException as e:
        print(f"  [INFO] PPG unavailable (expected for some devices): {e}")
    
    try:
        report.ppg_ir_amplitude = device.get_ppg_ir_amplitude()
        report.ppg_red_amplitude = device.get_ppg_red_amplitude()
        print(f"  [CAP] PPG IR={report.ppg_ir_amplitude}, Red={report.ppg_red_amplitude}")
    except CapsuleException as e:
        pass  # Optional
    
    try:
        ch_names = device.get_channel_names()
        report.channel_names = [ch_names.get_name_by_index(i) for i in range(len(ch_names))]
        print(f"  [CAP] Channels: {report.channel_names}")
    except CapsuleException as e:
        print(f"  [WARN] Channel names unavailable: {e}")
    
    # --- Battery ---
    try:
        report.battery_charge = device.get_battery_charge()
        print(f"  [CAP] Battery: {report.battery_charge}%")
    except CapsuleException as e:
        print(f"  [WARN] Battery read failed: {e}")
    
    # --- Start Streaming Test ---
    report.stream_test_attempted = True
    print(f"\n  [TEST] Starting signal stream (test duration: {STREAM_TEST_DURATION_SEC}s)...")
    
    try:
        device.start()
        print(f"  [OK] Start command sent")
    except CapsuleException as e:
        report.stream_test_error = f"Start failed: {e}"
        report.overall_result = "FAIL"
        report.failure_reason = report.stream_test_error
        print(f"  [FAIL] {report.stream_test_error}")
        device.disconnect()
        return report
    
    # Wait for mode change and EEG data
    stream_start = time.time()
    non_blocking_wait(mode_event, "mode change", 5, locator)
    
    # Wait for EEG samples
    eeg_event.sleep()
    got_eeg = non_blocking_wait(eeg_event, "EEG data", STREAM_TEST_DURATION_SEC, locator)
    
    # Collect more samples
    elapsed = 0
    while elapsed < STREAM_TEST_DURATION_SEC:
        time.sleep(0.1)
        locator.update()
        elapsed = time.time() - stream_start
    
    report.stream_samples_received = sum(eeg_samples)
    report.stream_test_duration_ms = int((time.time() - stream_start) * 1000)
    report.stream_test_passed = report.stream_samples_received > 0
    
    if report.stream_test_passed:
        print(f"  [OK] Stream test PASSED: {report.stream_samples_received} total samples in {report.stream_test_duration_ms}ms")
    else:
        report.stream_test_error = "No EEG samples received"
        print(f"  [FAIL] Stream test FAILED: No EEG samples received")
    
    # Get final mode
    try:
        mode = device.get_mode()
        report.device_mode = int(mode.value)
        mode_names = {0:"Resistance", 1:"Signal", 2:"SignalAndResist", 
                      3:"StartMEMS", 4:"StopMEMS", 5:"StartPPG", 6:"StopPPG"}
        report.device_mode_name = mode_names.get(report.device_mode, f"Unknown({report.device_mode})")
        print(f"  [INFO] Final mode: {report.device_mode_name}")
    except CapsuleException as e:
        print(f"  [WARN] get_mode failed: {e}")
    
    # --- Stop and Disconnect ---
    print(f"\n  [TEST] Stopping and disconnecting...")
    try:
        device.stop()
        print(f"  [OK] Stop command sent")
    except CapsuleException as e:
        print(f"  [WARN] Stop failed: {e}")
    
    connection_event.sleep()
    try:
        device.disconnect()
        print(f"  [OK] Disconnect command sent")
    except CapsuleException as e:
        print(f"  [WARN] Disconnect failed: {e}")
    
    non_blocking_wait(connection_event, "disconnection", 10, locator)
    
    # --- Final Result ---
    if report.stream_test_passed:
        report.overall_result = "PASS"
        print(f"\n  [RESULT] PASS - Device fully functional")
    else:
        report.overall_result = "FAIL"
        if not report.failure_reason:
            report.failure_reason = "Stream test failed - no EEG data"
        print(f"\n  [RESULT] FAIL - {report.failure_reason}")
    
    return report


def generate_report(system: SystemReport, output_dir: str):
    """Generate JSON and Markdown reports."""
    os.makedirs(output_dir, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    
    # JSON report
    json_path = os.path.join(output_dir, f"capsule_sdk_diagnose_{timestamp}.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(asdict(system), f, indent=2, ensure_ascii=False, default=str)
    print(f"\n[REPORT] JSON saved: {json_path}")
    
    # Markdown report
    md_path = os.path.join(output_dir, f"capsule_sdk_diagnose_{timestamp}.md")
    with open(md_path, "w", encoding="utf-8") as f:
        f.write("# Capsule SDK Device Diagnostic Report\n\n")
        f.write(f"**Date:** {system.timestamp}\n\n")
        f.write(f"**SDK Version:** {system.sdk_version}\n\n")
        f.write(f"**Python:** {system.python_version}\n\n")
        f.write(f"**DLL:** `{system.sdk_dll_path}` (exists: {system.sdk_dll_exists})\n\n")
        f.write("---\n\n")
        f.write(f"## Summary\n\n")
        f.write(f"- Devices tested: {system.devices_tested}\n")
        f.write(f"- Passed: {system.devices_passed}\n")
        f.write(f"- Failed: {system.devices_failed}\n\n")
        
        for i, dev_dict in enumerate(system.device_reports):
            f.write(f"## Device {i+1}: {dev_dict['device_name']}\n\n")
            f.write(f"| Property | Value |\n")
            f.write(f"|----------|-------|\n")
            f.write(f"| Serial | {dev_dict['device_serial']} |\n")
            f.write(f"| Type | {dev_dict['device_type']} ({dev_dict['device_type_code']}) |\n")
            f.write(f"| Discovery | {'Found' if dev_dict['discovery_found'] else 'Not found'} ({dev_dict['discovery_time_ms']}ms) |\n")
            f.write(f"| Connection | {dev_dict['connection_status_name']} ({dev_dict['connection_time_ms']}ms) |\n")
            f.write(f"| Info Name | {dev_dict['info_name'] or 'N/A'} |\n")
            f.write(f"| Info Serial | {dev_dict['info_serial'] or 'N/A'} |\n")
            f.write(f"| EEG Rate | {dev_dict['eeg_sample_rate'] or 'N/A'} Hz |\n")
            f.write(f"| MEMS Rate | {dev_dict['mems_sample_rate'] or 'N/A'} Hz |\n")
            f.write(f"| PPG Rate | {dev_dict['ppg_sample_rate'] or 'N/A'} Hz |\n")
            f.write(f"| Channels | {', '.join(dev_dict['channel_names']) or 'N/A'} |\n")
            f.write(f"| Battery | {dev_dict['battery_charge']}% |\n")
            f.write(f"| Stream Samples | {dev_dict['stream_samples_received']} |\n")
            f.write(f"| Stream Duration | {dev_dict['stream_test_duration_ms']}ms |\n")
            f.write(f"| Final Mode | {dev_dict['device_mode_name'] or 'N/A'} |\n")
            f.write(f"| BLE MAC Guess | {dev_dict['ble_mac_guess'] or 'N/A'} |\n")
            f.write(f"| BLE Services | {dev_dict['ble_services_count'] if dev_dict['ble_services_count'] is not None else 'N/A'} |\n")
            f.write(f"| BLE DIS | {dev_dict['ble_dis_present'] if dev_dict['ble_dis_present'] is not None else 'N/A'} |\n")
            f.write(f"| **Result** | **{dev_dict['overall_result']}** |\n")
            if dev_dict['failure_reason']:
                f.write(f"| Failure | {dev_dict['failure_reason']} |\n")
            f.write(f"\n")
        
        f.write("---\n\n")
        f.write("## BLE vs SDK Comparison\n\n")
        f.write("This table compares our custom BLE implementation findings with the official SDK results:\n\n")
        f.write("| Device | BLE Status | SDK Status | Diagnosis |\n")
        f.write("|--------|-----------|------------|-----------|\n")
        for dev_dict in system.device_reports:
            ble_status = "Unknown"
            if dev_dict['ble_services_count'] is not None:
                if dev_dict['ble_services_count'] == 0:
                    ble_status = "0 services (FAIL)"
                elif dev_dict['ble_services_count'] >= 3:
                    ble_status = f"{dev_dict['ble_services_count']} services (OK)"
                else:
                    ble_status = f"{dev_dict['ble_services_count']} services (WARN)"
            sdk_status = dev_dict['overall_result']
            
            if sdk_status == "PASS" and ble_status.startswith("0 services"):
                diagnosis = "SDK works but BLE fails → BLE stack/cache issue or pairing conflict"
            elif sdk_status == "PASS" and "OK" in ble_status:
                diagnosis = "Both work → Device is healthy"
            elif sdk_status == "FAIL" and ble_status.startswith("0 services"):
                diagnosis = "Both fail → Likely device hardware/firmware issue"
            elif sdk_status == "FAIL":
                diagnosis = "SDK fails → Device issue or incompatible firmware"
            else:
                diagnosis = "Inconclusive"
            
            f.write(f"| {dev_dict['device_name']} | {ble_status} | {sdk_status} | {diagnosis} |\n")
        
        f.write("\n")
    
    print(f"[REPORT] Markdown saved: {md_path}")
    return json_path, md_path


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    print("=" * 70)
    print("  CAPSULE SDK DEVICE DIAGNOSTIC TOOL")
    print("  Compares official SDK behavior with custom BLE implementation")
    print("=" * 70)
    
    # Check DLL
    dll_exists = os.path.exists(CAPSULE_DLL_PATH)
    print(f"\n[INIT] SDK DLL: {CAPSULE_DLL_PATH}")
    print(f"[INIT] DLL exists: {dll_exists}")
    if not dll_exists:
        print(f"[FATAL] CapsuleClient.dll not found!")
        sys.exit(1)
    
    # Load SDK
    print(f"\n[INIT] Loading Capsule SDK...")
    try:
        capsule = Capsule(CAPSULE_DLL_PATH)
        sdk_version = capsule.get_version()
        print(f"[OK] SDK Version: {sdk_version}")
    except Exception as e:
        print(f"[FATAL] Failed to load SDK: {e}")
        sys.exit(1)
    
    # Create device locator
    print(f"\n[INIT] Creating DeviceLocator...")
    log_dir = os.path.join(REPORT_DIR, "capsule_logs")
    os.makedirs(log_dir, exist_ok=True)
    locator = DeviceLocator(log_dir, capsule.get_lib())
    print(f"[OK] DeviceLocator created (logs: {log_dir})")
    
    # Discover devices
    print(f"\n[SCAN] Searching for {DEVICE_TYPE} devices (timeout: {SCAN_TIMEOUT_SEC}s)...")
    devices, discovery_time = discover_devices(locator, DEVICE_TYPE, SCAN_TIMEOUT_SEC)
    
    if not devices:
        print(f"\n[RESULT] No devices found. Possible reasons:")
        print(f"  - Device is not powered on or not in pairing mode")
        print(f"  - Bluetooth is disabled")
        print(f"  - Device is already connected to another application")
        print(f"  - Wrong device type (try DeviceType.Any = 4)")
        sys.exit(0)
    
    print(f"\n[SCAN] Discovered {len(devices)} device(s) in {discovery_time}ms")
    
    # Run diagnostics on each device
    device_reports = []
    passed = 0
    failed = 0
    
    for i, dev_info in enumerate(devices):
        # Try to match with known BLE MACs (by serial/name pattern)
        ble_mac = None
        ble_services = None
        ble_dis = None
        for mac, desc in KNOWN_BLE_MACS.items():
            if dev_info.get_serial() in desc or dev_info.get_name() in desc:
                ble_mac = mac
                break
        
        report = diagnose_single_device(
            capsule, dev_info, locator,
            ble_mac=ble_mac,
            ble_services=ble_services,
            ble_dis=ble_dis
        )
        device_reports.append(asdict(report))
        if report.overall_result == "PASS":
            passed += 1
        else:
            failed += 1
    
    # Generate system report
    system = SystemReport(
        timestamp=datetime.now().isoformat(),
        sdk_version=sdk_version,
        sdk_dll_path=CAPSULE_DLL_PATH,
        sdk_dll_exists=dll_exists,
        python_version=f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
        scan_timeout_sec=SCAN_TIMEOUT_SEC,
        connect_timeout_sec=CONNECT_TIMEOUT_SEC,
        devices_tested=len(devices),
        devices_passed=passed,
        devices_failed=failed,
        device_reports=device_reports,
    )
    
    json_path, md_path = generate_report(system, REPORT_DIR)
    
    print(f"\n{'='*70}")
    print(f"  DIAGNOSTIC COMPLETE")
    print(f"  Devices: {len(devices)} tested, {passed} passed, {failed} failed")
    print(f"  Reports: {json_path}")
    print(f"           {md_path}")
    print(f"{'='*70}")


if __name__ == "__main__":
    main()
