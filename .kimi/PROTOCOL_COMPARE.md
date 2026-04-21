# BrainBit vs Neiry Protocol Comparison
# Format: field | Neiry | BrainBit | match? | notes
# Updated: 2026-04-21

## BLE Layer
| Field | Neiry | BrainBit | Match? |
|-------|-------|----------|--------|
| Service UUID | 7e400001-b5a3-f393-e0a9-e50e24dcca95 | 6e400001-b5a3-f393-e0a9-e50e24dcca9e | ❌ DIFFERENT |
| TX Char UUID | 7e400002-b5a3-f393-e0a9-e50e24dcca95 | 6e400002-b5a3-f393-e0a9-e50e24dcca9e | ❌ DIFFERENT |
| RX Char UUID | 7e400003-b5a3-f393-e0a9-e50e24dcca95 | 6e400003-b5a3-f393-e0a9-e50e24dcca9e | ❌ DIFFERENT |
| UUID base | Nordic UART (0000xxxx-...) | Nordic UART (0000xxxx-...) | ✅ SAME base |
| Company prefix | 7e40 vs 6e40 | - | ❌ Different vendor prefix |

## Packet Structure (Hypothesis)
| Field | Neiry | BrainBit | Match? | Notes |
|-------|-------|----------|--------|-------|
| Packet size | 20 bytes | ? | ? | Standard BLE MTU |
| Header | Byte 0 = type? | ? | ? | Need BrainBit capture |
| EEG samples | 2ch × 3 bytes? | ? | ? | 250Hz, 24-bit ADC likely |
| Resistance | Interleaved? | ? | ? | Mode 2 = simultaneous |
| CRC/checksum | ? | ? | ? | Unknown |

## Startup Sequence
| Step | Neiry | BrainBit | Match? |
|------|-------|----------|--------|
| Powerdown | 0x01, delay 1200ms | ? | ? |
| Idle | 0x02, delay 50ms | ? | ? |
| Settings | Packet with sample rate, gain, etc | ? | ? |
| Start | 0x03 | ? | ? |
| Mode values | 0=Resist, 1=Signal, 2=Signal+Resist, 3=StartMEMS, 4=StopMEMS, 5=StartPPG, 6=StopPPG | ? | ? |

## Key Questions
1. Do BrainBit and Neiry share the same packet parser in SDK?
   - Check: CapsuleClient.dll exports — clCDevice for both types?
   - Action: Dump DLL exports, search for BrainBit-specific functions
2. Is the difference ONLY in UUIDs (marketing/branding)?
   - If YES → unified driver possible with UUID switch
   - If NO → separate parsers needed
3. Can we capture BrainBit traffic without owning device?
   - Option A: SDK simulator mode (SinWave=100, Noise=101)
   - Option B: Ask SDK support for protocol docs
   - Option C: Find BrainBit owner for remote capture

## Test Plan (when BrainBit available)
```
1. Run capsule_sdk_diagnose.py with DeviceType.BrainBit
2. Compare: connection time, modes, channels, sample rates
3. Capture raw BLE packets with --verbose
4. Compare packet structure byte-by-byte
5. Test: can Neiry startup sequence work on BrainBit?
```

## Files to Check
- `CapsuleClientPython/DeviceType.py` — BrainBit = 6
- `CapsuleClientPython/Device.py` — modes same for all types?
- `neiry_bt_protocol.md` — our reverse-engineered docs
