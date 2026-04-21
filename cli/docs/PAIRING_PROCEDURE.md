# Pairing Procedure for Multi-Device Connection

## Problem

Neiry Headband devices can only maintain **one active BLE connection** at a time. If a device was previously connected to a phone/tablet/another PC, it will not be discoverable until re-entered into pairing mode.

## Symptoms

- `0 services after GATT connect` — device paired elsewhere
- Device not found during BLE scan — device asleep or paired elsewhere
- `scanMultiple` hangs waiting for 2nd device — only 1 device discoverable

## Solution: Pairing Mode

### Step 1: Prepare ALL devices

For **each** device you want to connect:

1. **Long-press the button** on the device until the LED starts blinking
2. **Release the button** — device is now in pairing mode
3. **Keep the device within 2 meters** of the PC

> ⚠️ **Important:** Do this for ALL devices BEFORE running the scan. If you do it one-by-one, the first device may timeout before you finish with the second.

### Step 2: Run multi-device scan

```bash
cd cli
npx tsx src/index.ts --auto --max-devices 2 --duration 60
```

### Step 3: Verify both devices connected

Check the output for:
```
[OK] Added Headband (1/2)
[OK] Added Headband (2/2)
```

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| Only 1 device found | 2nd device paired elsewhere | Long-press button on 2nd device, re-run |
| 0 services | Device paired elsewhere | Long-press button to re-enter pairing mode |
| Connection timeout | Device too far | Move within 2 meters |
| `0x85` error | BLE connection limit | Disconnect other BLE devices |

## Device Registry

| S/N | MAC | Status | Notes |
|-----|-----|--------|-------|
| 822058 | fc:e3:27:df:34:61 | ✅ Validated | Battery 65%. Works via SDK + BLE. |
| 821654 | c0:33:3e:e4:e5:1c | ✅ Validated | Battery 95%. Requires pairing mode. |

## Technical Details

- **Pairing mode duration:** ~30-60 seconds (LED blinking)
- **After pairing mode:** device enters normal advertising
- **Windows BLE cache:** may show stale device names — ignore, use MAC
- **SDK vs BLE:** SDK uses proprietary discovery; BLE uses standard advertising
