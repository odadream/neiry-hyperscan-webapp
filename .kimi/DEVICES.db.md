# Device Database
# Format: compact table per device. Link SDK↔BLE records by serial/MAC.
# Updated: 2026-04-21

## D1: Headband S/N 822058
| Field | Value |
|-------|-------|
| serial | 822058 |
| name | Headband |
| type | Band (0) |
| sdk_ver | v2.0.40-3810ba818 |
| validated | 2026-04-21 |
| ble_macs | fc:e3:27:df:34:61, c0:33:3e:e4:e5:1c |
| eeg_hz | 250 |
| mems_hz | 250 |
| ppg_hz | 100 |
| ch_bipolar | O1-T3, O2-T4 |
| ch_mono | O1, O2, T3, T4 |
| modes | Signal(1), Resist(0), Signal+Resist(2) |
| battery_pct | 65→64 |
| neiry_uuid | 7e400001-b5a3-f393-e0a9-e50e24dcca95 |
| has_dis | NO |
| sdk_status | PASS |
| ble_status | INTERMITTENT |
| health_score | 70 |
| notes | 0-services issue on c0:33 MAC. Powercycle fixes. |

## D2: Headband S/N 821654 (VALIDATED)
| Field | Value |
|-------|-------|
| serial | 821654 |
| name | Headband |
| type | Band (0) |
| sdk_ver | v2.0.40-3810ba818 |
| validated | 2026-04-21 |
| ble_macs | c0:33:3e:e4:e5:1c |
| eeg_hz | 250 |
| mems_hz | 250 |
| ppg_hz | 100 |
| ch_bipolar | O1-T3, O2-T4 |
| ch_mono | O1, O2, T3, T4 (inferred) |
| modes | Signal(1), Resist(0), Signal+Resist(2) |
| battery_pct | 95% → 95% |
| neiry_uuid | 7e400001-b5a3-f393-e0a9-e50e24dcca95 |
| has_dis | NO |
| sdk_status | PASS |
| ble_status | PASS (3 services, streaming OK) |
| health_score | 95 (new device, high battery) |
| notes | Requires long-press button for pairing mode. Then standard SDK connect. 1025 samples/5s. |

## D3: (placeholder for BrainBit)
| Field | Value |
|-------|-------|
| serial | ? |
| name | BrainBit |
| type | BrainBit (6) |
| sdk_ver | ? |
| validated | ? |
| ble_macs | ? |
| eeg_hz | ? |
| mems_hz | ? |
| ppg_hz | ? |
| ch_bipolar | ? |
| ch_mono | ? |
| modes | ? |
| battery_pct | ? |
| neiry_uuid | 6e400001-b5a3-f393-e0a9-e50e24dcca9e |
| has_dis | ? |
| sdk_status | ? |
| ble_status | ? |
| health_score | ? |
| notes | Need device for validation. UUID diff from Neiry. |
