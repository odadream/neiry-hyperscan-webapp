# History Log
# Format: YYYY-MM-DD HH:MM | phase | action | result | notes
# Keep compact. One line per event. Expand in code comments if needed.
2026-04-21 13:02 | P1.4 | done | Multi-device stress test PASSED. Both devices (822058 + 821654) connected and streaming simultaneously. |
2026-04-21 13:02 | P3.2 | done | Multi-device streaming SUCCESS! 2 devices simultaneously. Discovered: 2, Connected: 2, Streaming: 2. CSV files generated. |
2026-04-21 12:56 | P3.2 | wip | Multi-device scan blocks on second device. Need timeout in scanMultiple. Device 821654 works, 822058 needs re-pairing. |
2026-04-21 12:54 | P6.3 | done | 0-services root cause identified: device paired elsewhere (phone). Fix: long-press button to re-enter pairing mode, then connect. |
2026-04-21 12:54 | P1.2 | done | SN 821654 BLE test PASS. c0:33:3e:e4:e5:1c = 3 services, streaming OK. Root cause of previous 0-services: device was connected to phone, not in pairing mode. |
2026-04-21 12:52 | P1.1 | done | Both devices validated: 822058 (battery 65%) and 821654 (battery 95%). Same specs: 250Hz EEG, 2ch bipolar O1-T3/O2-T4, Signal+Resist mode. |
2026-04-21 12:52 | P1.4 | done | SN 821654 validated via SDK. 250Hz EEG, 2ch, Signal+Resist. Battery 95%. 1025 samples/5s. Pairing mode = long-press button. |
2026-04-21 12:50 | P1.4 | wip | SN 821654 requires pairing mode (long-press button). Script capture_new_device.py ready. |
2026-04-21 12:42 | P1.4 | wip | Need 2+ healthy devices for stress test |

2026-04-21 15:37 | P1.4 | ConnectionHistory module created | DONE | JSONL per event. Summary per device. Health trend tracking.
2026-04-21 15:35 | P1.3 | --history + --history-device CLI commands | DONE | Shows summaries, recent events, failure patterns.
2026-04-21 15:30 | P1.3 | PLAN.md + DEVICES.db.md + HISTORY.log.md created | DONE | Compact AI-oriented tracking files in .kimi/
2026-04-21 12:32 | P1.3 | --sdk-compare run | OK | Found c0:33 MAC, matched SDK profile 822058. Device healthy at BLE adv level.
2026-04-21 12:28 | P1.1 | capsule_sdk_diagnose.py run | PASS | S/N 822058. 250Hz EEG, 2ch, Signal+Resist. 1175 samples/5s.
2026-04-21 12:00 | P1.2 | BLE diagnose-device on c0:33 | FAIL | 0 services after GATT connect. Hypothesis: state/cache issue.
2026-04-21 11:30 | P1.2 | BLE diagnose-device on fc:e3 | OK | 3 services. Neiry UUID found. No DIS. Battery read OK.
2026-04-21 10:00 | P2.2 | Document startup sequence | DONE | 0x01(powerdown,1200ms)→0x02(idle,50ms)→settings→0x03(start). Mode 2=Signal+Resist.
2026-04-20 18:00 | P3.1 | Sequential auto-connect | DONE | 2.5s delay. Retry on 0x85. 3 attempts.
2026-04-20 15:00 | P3.3 | CSV rotation | DONE | Per-device CSV. Session dir. Structured logger.
2026-04-19 12:00 | P1.1 | webbluetooth chosen over noble | DECISION | Better Win support. deviceFound callback.
