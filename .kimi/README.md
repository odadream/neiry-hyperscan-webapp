# .kimi — AI Agent Workspace

Compact tracking files for the Neiry Hyperscan project. Designed for minimal context usage.

## Files

| File | Purpose | Update Rule |
|------|---------|-------------|
| `PLAN.md` | Roadmap with phases/steps/status | After every milestone via `update_plan.cjs` |
| `DEVICES.db.md` | Known devices, SDK↔BLE cross-link | After SDK validation or new device discovery |
| `HISTORY.log.md` | Chronological event log | Auto via `update_plan.cjs` or manual |
| `PROTOCOL_COMPARE.md` | BrainBit vs Neiry protocol diff | When new protocol data available |
| `update_plan.cjs` | Script to update PLAN + HISTORY | Run after each success/failure |

## Quick Commands

```bash
# Update plan after milestone
node .kimi/update_plan.cjs P2.3 done "Packet format: 20b header+2samples"

# View all device history
npx tsx cli/src/index.ts --history

# View specific device
npx tsx cli/src/index.ts --history-device <mac>

# Compare BLE scan with SDK profiles
npx tsx cli/src/index.ts --sdk-compare

# Validate device with SDK (Python)
cd cli/tools && python capsule_sdk_diagnose.py
```

## Status Legend

- `[ ]` todo — not started
- `[~]` wip — in progress
- `[x]` done — completed
- `[!]` blocked — has blocker
- `[?]` deferred — postponed

## Current Focus

Phase P1 (Device Diagnostics) nearly complete. P2 (Protocol RE) in progress.
Key blocker: Need 2+ healthy devices for multi-device stress test (P1.4).
