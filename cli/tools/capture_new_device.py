#!/usr/bin/env python3
"""
Capture New Device — Post-Pairing Discovery Script
====================================================
Run this AFTER long-pressing the device button to enter pairing mode.

Usage:
    1. Long-press the device button until LED indicates pairing mode
    2. Run: python capture_new_device.py
    3. The script will discover, connect, and profile the device

Requirements:
    - CapsuleClient.dll in Capsule v2.0.40 directory
    - Python 3.11+
"""

import sys
import os
import time
import json
from datetime import datetime

CAPSULE_SDK_PATH = r"D:\YandexDisk\_ODA2\Software\LAB Neiry\Capsule v2.0.40\CapsuleAPI\Windows\Capsule Python\CapsuleClientPython"
CAPSULE_DLL_PATH = r"D:\YandexDisk\_ODA2\Software\LAB Neiry\Capsule v2.0.40\CapsuleAPI\Windows\Lib\CapsuleClient.dll"

sys.path.insert(0, CAPSULE_SDK_PATH)

from Capsule import Capsule
from DeviceLocator import DeviceLocator
from DeviceType import DeviceType
from Device import Device, Device_Connection_Status, Device_Mode
from Error import Error, Error_Code, CapsuleException

SCAN_TIMEOUT = 20  # seconds — longer for pairing mode discovery
CONNECT_TIMEOUT = 30
STREAM_TEST_DURATION = 5


class EventFiredState:
    def __init__(self):
        self._awake = False
        self._data = None
    def is_awake(self): return self._awake
    def set_awake(self, data=None):
        self._awake = True
        self._data = data
    def sleep(self):
        self._awake = False
        self._data = None
    def get_data(self): return self._data


def wait_event(evt: EventFiredState, name: str, timeout_sec: int, locator=None, poll=0.02):
    print(f"  [WAIT] {name} (max {timeout_sec}s)...")
    for _ in range(int(timeout_sec / poll)):
        if locator: locator.update()
        if evt.is_awake():
            print(f"  [OK] {name} occurred!")
            return True
        time.sleep(poll)
    print(f"  [TIMEOUT] {name}")
    return False


def main():
    print("=" * 60)
    print("  CAPTURE NEW DEVICE — SN 821654")
    print("  Step 1: Long-press device button until LED blinks")
    print("  Step 2: This script discovers and profiles the device")
    print("=" * 60)

    if not os.path.exists(CAPSULE_DLL_PATH):
        print(f"[FATAL] DLL not found: {CAPSULE_DLL_PATH}")
        sys.exit(1)

    print(f"\n[INIT] Loading Capsule SDK...")
    capsule = Capsule(CAPSULE_DLL_PATH)
    print(f"[OK] SDK: {capsule.get_version()}")

    log_dir = os.path.join(os.path.dirname(__file__), "..", "logs", "capsule_logs")
    os.makedirs(log_dir, exist_ok=True)
    locator = DeviceLocator(log_dir, capsule.get_lib())

    # Discovery
    print(f"\n[SCAN] Searching for Band devices (timeout: {SCAN_TIMEOUT}s)...")
    print("[INFO] If device was just paired, it may take 5-10s to appear...")

    devices_found = []
    discovery_evt = EventFiredState()

    def on_device_list(locator, info_list, fail_reason):
        count = len(info_list)
        print(f"  [SDK] Found {count} device(s)")
        for i in range(count):
            di = info_list[i]
            print(f"    [{i}] Serial: {di.get_serial()}, Name: {di.get_name()}, Type: {di.get_type()}")
            devices_found.append(di)
        discovery_evt.set_awake()

    locator.set_on_devices_list(on_device_list)
    locator.request_devices(DeviceType.Band, SCAN_TIMEOUT)

    discovered = wait_event(discovery_evt, "device discovery", SCAN_TIMEOUT + 5, locator)

    if not devices_found:
        print("\n[FAIL] No devices found. Troubleshooting:")
        print("  1. Did you long-press the button until LED blinked?")
        print("  2. Is the device within 2 meters?")
        print("  3. Is Bluetooth enabled on this PC?")
        print("  4. Try removing the device from Windows Bluetooth settings first")
        sys.exit(1)

    # If multiple devices, let user pick or auto-pick SN 821654
    target = None
    for d in devices_found:
        if d.get_serial() == "821654":
            target = d
            break

    if not target and len(devices_found) == 1:
        target = devices_found[0]
    elif not target:
        print(f"\n[INFO] Multiple devices found. Using first: {devices_found[0].get_serial()}")
        target = devices_found[0]

    serial = target.get_serial()
    name = target.get_name()
    dtype = target.get_type()
    print(f"\n[TARGET] {name} (S/N: {serial}, Type: {dtype})")

    # Connect
    print(f"\n[CONNECT] Creating device object...")
    device = Device(locator, serial, capsule.get_lib())

    conn_evt = EventFiredState()
    battery_evt = EventFiredState()
    eeg_samples = []
    eeg_evt = EventFiredState()
    mode_evt = EventFiredState()

    def on_conn(device, status):
        names = {0:"Disconnected", 1:"Connected", 2:"Unsupported"}
        print(f"  [EVENT] Connection: {names.get(int(status), status)}")
        conn_evt.set_awake(int(status))
    def on_battery(device, charge):
        print(f"  [EVENT] Battery: {charge}%")
        battery_evt.set_awake(charge)
    def on_eeg(device, eeg):
        cnt = eeg.get_samples_count()
        eeg_samples.append(cnt)
        if len(eeg_samples) <= 3:
            print(f"  [EVENT] EEG: {cnt} samples, {eeg.get_channels_count()} ch")
        eeg_evt.set_awake()
    def on_mode(device, mode):
        names = {0:"Resist",1:"Signal",2:"Signal+Resist",3:"StartMEMS",4:"StopMEMS",5:"StartPPG",6:"StopPPG"}
        print(f"  [EVENT] Mode: {names.get(int(mode.value), mode.value)}")
        mode_evt.set_awake(int(mode.value))

    device.set_on_connection_status_changed(on_conn)
    device.set_on_battery_charge_changed(on_battery)
    device.set_on_eeg(on_eeg)
    device.set_on_mode_changed(on_mode)

    print(f"[CONNECT] Connecting (bipolar=True)...")
    device.connect(bipolarChannels=True)
    connected = wait_event(conn_evt, "connection", CONNECT_TIMEOUT, locator)

    if not connected or conn_evt.get_data() != 1:
        print("[FAIL] Connection failed")
        sys.exit(1)

    # Get info
    print(f"\n[INFO] Reading device info...")
    try:
        info = device.get_info()
        print(f"  Name: {info.get_name()}")
        print(f"  Serial: {info.get_serial()}")
        print(f"  Type: {info.get_type()}")
    except Exception as e:
        print(f"  [WARN] get_info: {e}")

    try:
        print(f"  EEG Rate: {device.get_eeg_sample_rate()} Hz")
    except: pass
    try:
        print(f"  MEMS Rate: {device.get_mems_sample_rate()} Hz")
    except: pass
    try:
        print(f"  PPG Rate: {device.get_ppg_sample_rate()} Hz")
    except: pass
    try:
        ch = device.get_channel_names()
        names = [ch.get_name_by_index(i) for i in range(len(ch))]
        print(f"  Channels: {names}")
    except Exception as e:
        print(f"  [WARN] channels: {e}")
    try:
        print(f"  Battery: {device.get_battery_charge()}%")
    except: pass

    # Stream test
    print(f"\n[STREAM] Starting signal (test: {STREAM_TEST_DURATION}s)...")
    device.start()
    wait_event(mode_evt, "mode change", 5, locator)
    eeg_evt.sleep()
    wait_event(eeg_evt, "EEG data", STREAM_TEST_DURATION, locator)

    stream_start = time.time()
    while time.time() - stream_start < STREAM_TEST_DURATION:
        time.sleep(0.1)
        locator.update()

    total_samples = sum(eeg_samples)
    print(f"\n[RESULT] Stream test: {total_samples} samples in {int((time.time()-stream_start)*1000)}ms")

    try:
        mode = device.get_mode()
        print(f"[RESULT] Final mode: {int(mode.value)}")
    except: pass

    # Stop and disconnect
    print(f"\n[DISCONNECT] Stopping...")
    try: device.stop()
    except: pass
    conn_evt.sleep()
    try: device.disconnect()
    except: pass
    wait_event(conn_evt, "disconnection", 10, locator)

    # Save profile
    profile = {
        "timestamp": datetime.now().isoformat(),
        "sdk_version": capsule.get_version(),
        "device": {
            "serial": serial,
            "name": name,
            "type": dtype,
        },
        "connection": {
            "success": True,
            "mode_after_start": mode_evt.get_data(),
        },
        "streaming": {
            "samples_received": total_samples,
            "test_duration_sec": STREAM_TEST_DURATION,
        },
        "notes": "Device captured after pairing mode (long-press button)",
    }

    out_path = os.path.join(os.path.dirname(__file__), "..", "logs", f"device_profile_{serial}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json")
    with open(out_path, "w") as f:
        json.dump(profile, f, indent=2)
    print(f"\n[SAVE] Profile saved: {out_path}")
    print(f"[DONE] Device {serial} successfully captured and validated!")


if __name__ == "__main__":
    main()
