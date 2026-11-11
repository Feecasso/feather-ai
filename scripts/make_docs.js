#!/usr/bin/env node
'use strict';

/**
 * Regenerate docs/CHECKS.md and docs/REPAIRS.md from src/shared/catalog.js so the
 * documentation always matches the shipped tools.
 *
 *   node scripts/make_docs.js
 */

const fs = require('node:fs');
const path = require('node:path');
const { tools } = require('../src/shared/catalog');

const root = path.resolve(__dirname, '..');
const docs = path.join(root, 'docs');

const platformLabel = (platforms) => {
  if (platforms.length === 2) return 'Windows, Linux';
  return platforms[0] === 'win32' ? 'Windows' : 'Linux';
};

function checksDoc() {
  const lines = [
    '# Checks',
    '',
    'Every check is read-only. If a check cannot read a protected source (for example',
    'the Windows Security log), it reports **Info** with an explanation instead of',
    'guessing. Tables are generated from `src/shared/catalog.js`.',
    '',
    '## Status meanings',
    '',
    '| Status | Meaning |',
    '| --- | --- |',
    '| Pass | The measured value is within the documented range. |',
    '| Info | Information only. No problem was determined. |',
    '| Warning | A weakness or unusual condition needs review. |',
    '| Fail | A security-relevant condition failed the check. |',
    '| Error | The check could not complete. |',
    '| Skipped | The check does not apply or is unavailable. |',
    '',
    '## Fixed thresholds',
    '',
    '- System drive free space: **Fail** below 5%, **Warning** below 15%.',
    '- Memory use at or above **90%**: **Warning**.',
    '- Windows Defender signature age over **7 days**: **Warning**.',
    '- Linux ClamAV signature age over **14 days**: **Warning**.',
    '- Latest installed Windows update older than **90 days**: **Warning**.',
    '- Uptime of **30 days or more**: informational next step to restart.',
    '- Failed authentication events: **Warning** at 10 or more in 24 hours.',
    '- Publicly bound high-risk ports: 21, 23, 135, 139, 445, 1433, 3306, 3389,',
    '  5432, 5900, 6379, 27017.',
    '',
    'These thresholds live in the platform modules and are intentionally simple so',
    'the same measurement always produces the same status.',
    ''
  ];
  for (const tool of tools) {
    if (!tool.checks || !tool.checks.length) continue;
    lines.push(`## ${tool.title}`, '', tool.intro, '');
    lines.push('| Check | Platforms | Typical time | What it reads |');
    lines.push('| --- | --- | --- | --- |');
    for (const check of tool.checks) {
      const seconds = Math.round(check.timeout / 1000);
      lines.push(
        `| ${check.name} | ${platformLabel(check.platforms)} | ~${seconds} s | ${check.description.replace(/\|/g, '\\|')} |`
      );
    }
    lines.push('');
  }
  lines.push('## Notes', '');
  lines.push('- Timings are upper bounds. A check finishes as soon as the operating system answers.');
  lines.push('- The Security Scan is an observation tool, not an antivirus engine and not proof of compromise.');
  lines.push('- Update checks read cached metadata only. They never contact update servers.');
  lines.push('- SSH configuration checks apply to Linux only and inspect `sshd_config` plus drop-ins.');
  lines.push('');
  return lines.join('\n');
}

function repairsDoc() {
  const lines = [
    '# Repair actions',
    '',
    'Repairs change the computer. Nothing runs automatically. Every action requires:',
    '',
    '1. A click on its own **Approve & Run** button.',
    '2. A confirmation in the in-app dialog.',
    '3. A single-use approval token issued by the main process (valid for 2 minutes).',
    '4. The operating system approval prompt when the action needs administrator rights.',
    '',
    'Risk levels describe the potential impact, not how likely a problem is. A',
    'restore point or snapshot is recommended before Moderate or High actions.',
    '',
    'Tables are generated from `src/shared/catalog.js`.',
    ''
  ];
  for (const tool of tools) {
    if (!tool.repairs || !tool.repairs.length) continue;
    lines.push(`## ${tool.title}`, '');
    lines.push('| Action | Risk | Admin | Restart | Platforms | Impact |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    for (const repair of tool.repairs) {
      lines.push(
        `| ${repair.name} | ${repair.risk} | ${repair.admin ? 'Yes' : 'No'} | ${repair.reboot ? 'Yes' : 'No'} | ${platformLabel(repair.platforms)} | ${repair.impact.replace(/\|/g, '\\|')} |`
      );
    }
    lines.push('');
  }
  lines.push('## Notes', '');
  lines.push('- **Cancel** stops an operation where the operating system allows it. An elevated helper may already be running.');
  lines.push('- **No automatic rollback** exists for most repairs. Create a restore point or snapshot first.');
  lines.push('- Failed and cancelled repairs are recorded in the audit log and the report.');
  lines.push('- Repairs never run on a schedule, at startup, or without a fresh approval.');
  lines.push('');
  return lines.join('\n');
}

fs.mkdirSync(docs, { recursive: true });
fs.writeFileSync(path.join(docs, 'CHECKS.md'), checksDoc());
fs.writeFileSync(path.join(docs, 'REPAIRS.md'), repairsDoc());
console.log('Wrote docs/CHECKS.md and docs/REPAIRS.md');
