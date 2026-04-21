# Plan: Neiry Hyperscan WebApp

# Format: phase|step|status|key_findings|blockers|next_action

# Status: [ ]todo [~]wip [x]done [!]blocked [?]deferred

## P1 Device Diagnostics

P1.1 SDK discovery+connect+stream test| [x] | Both devices validated: 822058 (battery 65%) and 821654 (battery 95%). Same specs: 250Hz EEG, 2ch bipolar O1-T3/O2-T4, Signal+Resist mode. |-|-
P1.2 BLE vs SDK cross-validation| [x] | SN 821654 BLE test PASS. c0:33:3e:e4:e5:1c = 3 services, streaming OK. Root cause of previous 0-services: device was connected to phone, not in pairing mode. |-|-
P1.3 Device health scoring | [x] | 0-100 score. 0 svcs=-50, no Neiry sv=-30, reliability<50%=-25. | - | -
P1.4 Multi-device stress test| [x] | Multi-device stress test PASSED. Both devices (822058 + 821654) connected and streaming simultaneously. |Need 2+ healthy devices|P2

## P2 Protocol Reverse Engineering

P2.1 Capture SDK→device traffic | [ ] | - | Need BLE sniffer or Windows BT logs | P2.2
P2.2 Document startup sequence | [~] | Powerdown(0x01,1200ms)→Idle(0x02,50ms)→Settings→Start(0x03). Mode 2=Signal+Resist. | - | P2.3
P2.3 Decode packet format | [~] | 20-byte packets. Header+samples. Need full bit layout. | - | P2.4
P2.4 Resistance packet format | [ ] | - | Need capture or SDK source | P2.5
P2.5 MEMS/PPG packet format | [ ] | - | Need capture or SDK source | P3
P2.6 BrainBit vs Neiry protocol diff | [ ] | - | Need BrainBit device or docs | P4

## P3 Multi-Device EEG Collection

P3.1 Sequential connect with delays | [x] | 2.5s inter-device. Retry on 0x85. | - | -
P3.2 Parallel streaming (2+ devices)| [x] | Multi-device streaming SUCCESS! 2 devices simultaneously. Discovered: 2, Connected: 2, Streaming: 2. CSV files generated. |Need 2 healthy devices|P3.3
P3.3 CSV rotation + sync timestamps | [x] | Per-device CSV. Session dir. | - | -
P3.4 Real-time webapp visualization | [ ] | - | WebSocket/Server-Sent Events | P5

## P4 BrainBit Compatibility

P4.1 BrainBit UUID scan | [ ] | UUID prefix 6e400001 vs Neiry 7e400001 | No BrainBit device | P4.2
P4.2 Protocol comparison | [ ] | Same Nordic UART structure? Same packet format? | Need both devices side-by-side | P4.3
P4.3 Unified driver if compatible | [ ] | - | Depends on P4.2 | P5

## P5 WebApp Integration

P5.1 Web Bluetooth API in browser | [ ] | - | Chrome/Edge only. Win10 BLE limit 7. | P5.2
P5.2 Real-time EEG chart | [ ] | - | Canvas/WebGL. 250Hz × 2ch. | P5.3
P5.3 Multi-device dashboard | [ ] | - | Device cards. Health scores. Battery. | P5.4
P5.4 Session recording + export | [ ] | - | CSV/EDF. Timestamp sync. | -

## P6 Production Hardening

P6.1 Auto-reconnect on disconnect | [ ] | - | - | -
P6.2 BLE cache management (Windows) | [ ] | - | Adapter reset. Device unpair. | -
P6.3 Error recovery: 0-services| [x] | 0-services root cause identified: device paired elsewhere (phone). Fix: long-press button to re-enter pairing mode, then connect. |Powerdown→delay→retry.|-
P6.4 Cross-platform: macOS/Linux | [ ] | - | SimpleBLE differences. | -
