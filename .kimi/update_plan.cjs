#!/usr/bin/env node
/**
 * Update .kimi tracking files after a milestone
 * Usage: node .kimi/update_plan.js <phase.step> <status> "notes"
 * Example: node .kimi/update_plan.js P2.3 done "Packet format decoded: 20b header+2samples"
 */

const fs = require('fs');
const path = require('path');

const KIMI_DIR = path.join(__dirname);
const PLAN_FILE = path.join(KIMI_DIR, 'PLAN.md');
const HISTORY_FILE = path.join(KIMI_DIR, 'HISTORY.log.md');

function now() {
  const d = new Date();
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

function updatePlan(stepId, status, notes) {
  let content = fs.readFileSync(PLAN_FILE, 'utf-8');
  const lines = content.split('\n');
  let found = false;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith(stepId + ' ')) {
      // Format: P2.3 name | [~] | notes | blockers | next
      const parts = lines[i].split('|').map(s => s.trim());
      if (parts.length >= 3) {
        const newStatus = status === 'done' ? '[x]' : status === 'wip' ? '[~]' : status === 'blocked' ? '[!]' : '[ ]';
        parts[1] = ` ${newStatus} `;
        if (notes) parts[2] = ` ${notes} `;
        lines[i] = parts.join('|');
        found = true;
      }
    }
  }

  if (!found) {
    console.error(`Step ${stepId} not found in PLAN.md`);
    process.exit(1);
  }

  fs.writeFileSync(PLAN_FILE, lines.join('\n'));
  console.log(`✅ Updated ${stepId} → ${status}`);
}

function addHistory(stepId, status, notes) {
  const line = `${now()} | ${stepId} | ${status} | ${notes || '-'} |`;
  let content = '';
  if (fs.existsSync(HISTORY_FILE)) {
    content = fs.readFileSync(HISTORY_FILE, 'utf-8');
  }
  const lines = content.split('\n');
  // Insert after header lines (first 3 lines are comments)
  lines.splice(3, 0, line);
  fs.writeFileSync(HISTORY_FILE, lines.join('\n'));
  console.log(`📝 Added history entry`);
}

// Main
const [,, stepId, status, ...notesParts] = process.argv;
const notes = notesParts.join(' ');

if (!stepId || !status) {
  console.log('Usage: node .kimi/update_plan.js <phase.step> <status> [notes]');
  console.log('Status: done | wip | blocked | todo | deferred');
  process.exit(1);
}

updatePlan(stepId, status, notes);
addHistory(stepId, status, notes);
