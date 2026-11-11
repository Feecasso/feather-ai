'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { reportsDir } = require('./paths');

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_LINE_BYTES = 32 * 1024;

/**
 * Append-only local audit trail. It intentionally records actions and short
 * summaries, not full evidence dumps or credentials.
 */
function createAudit() {
  const file = path.join(reportsDir(), 'audit-log.jsonl');
  try {
    const stat = fs.statSync(file);
    if (stat.size > MAX_BYTES) {
      const previous = `${file}.1`;
      try {
        fs.rmSync(previous, { force: true });
      } catch {
        /* ignore */
      }
      fs.renameSync(file, previous);
    }
  } catch {
    /* new file */
  }

  const entries = [];
  function audit(event, detail = '', extra = {}) {
    const entry = {
      at: new Date().toISOString(),
      event: String(event).slice(0, 120),
      detail: String(detail).slice(0, 4000),
      ...extra
    };
    const line = `${JSON.stringify(entry)}\n`;
    try {
      fs.appendFileSync(file, line.length > MAX_LINE_BYTES ? line.slice(0, MAX_LINE_BYTES) + '\n' : line, { mode: 0o600 });
    } catch {
      /* auditing must not crash the app */
    }
    entries.push(entry);
    if (entries.length > 500) entries.shift();
    return entry;
  }

  audit.recent = (limit = 50) => entries.slice(-limit);
  audit.file = file;
  audit.entries = entries;
  return audit;
}

module.exports = { createAudit };
