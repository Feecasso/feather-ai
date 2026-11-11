'use strict';

const path = require('node:path');

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const STATUS_LABEL = {
  pass: 'Pass',
  info: 'Info',
  warn: 'Warning',
  fail: 'Fail',
  error: 'Error',
  skip: 'Skipped'
};

function formatDate(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return String(value || 'unknown');
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
}

function buildReport({ tool, run, repairs = [], systemInfo = {}, version = '1.0.0', generatedAt = new Date().toISOString(), audit = [] }) {
  if (!run || !Array.isArray(run.results)) throw new Error('There are no check results to report.');
  const results = run.results;
  const summary = run.summary || { total: results.length, pass: 0, info: 0, warn: 0, fail: 0, error: 0, skip: 0 };
  const title = `Feather AI ${tool?.title || 'Report'}`;
  const rows = results
    .map(
      (r) => `<tr class="status-${escapeHtml(r.status)}">
        <td>${escapeHtml(r.name)}</td>
        <td><span class="badge">${escapeHtml(STATUS_LABEL[r.status] || r.status)}</span></td>
        <td>${escapeHtml(r.finding)}</td>
      </tr>`
    )
    .join('\n');

  const details = results
    .map(
      (r) => `<section class="detail">
        <h3>${escapeHtml(r.name)} <span class="badge">${escapeHtml(STATUS_LABEL[r.status] || r.status)}</span></h3>
        <p class="finding"><strong>Finding:</strong> ${escapeHtml(r.finding)}</p>
        <h4>Evidence (observed data)</h4>
        <pre>${escapeHtml(r.evidence)}</pre>
        <h4>Explanation</h4>
        <p>${escapeHtml(r.explanation)}</p>
        <h4>Suggested next step</h4>
        <p>${escapeHtml(r.nextStep)}</p>
      </section>`
    )
    .join('\n');

  const repairRows = repairs.length
    ? repairs
        .map(
          (r) => `<tr>
            <td>${escapeHtml(r.name || r.repairId)}</td>
            <td>${escapeHtml(r.risk || '')}</td>
            <td>${escapeHtml(r.outcome || '')}</td>
            <td>${formatDate(r.startedAt)}</td>
            <td>${escapeHtml(r.summary || '')}</td>
          </tr>`
        )
        .join('\n')
    : '<tr><td colspan="5">No repair actions were run in this session.</td></tr>';

  const auditRows = audit.length
    ? audit
        .map(
          (a) => `<tr><td>${formatDate(a.at)}</td><td>${escapeHtml(a.event)}</td><td>${escapeHtml(a.detail || '')}</td></tr>`
        )
        .join('\n')
    : '<tr><td colspan="3">No audit entries in this report scope.</td></tr>';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} - ${escapeHtml(formatDate(generatedAt))}</title>
<style>
  :root { color-scheme: light; }
  body { background:#fff; color:#111; font:14px/1.5 "Segoe UI", Tahoma, Arial, sans-serif; margin:0; padding:28px; }
  header { border-bottom:3px double #000080; margin-bottom:20px; padding-bottom:12px; }
  h1 { color:#000080; font-size:24px; margin:0 0 4px; }
  h2 { border-bottom:1px solid #808080; font-size:18px; margin-top:28px; padding-bottom:4px; }
  h3 { font-size:15px; margin:0 0 8px; }
  h4 { font-size:13px; margin:14px 0 4px; color:#000080; }
  .meta { display:grid; grid-template-columns:170px 1fr; gap:4px 12px; margin:12px 0; }
  .meta dt { font-weight:600; }
  .meta dd { margin:0; }
  table { border-collapse:collapse; width:100%; margin:10px 0 18px; }
  th, td { border:1px solid #999; padding:6px 8px; text-align:left; vertical-align:top; }
  th { background:#d4d0c8; }
  tr.status-fail td, tr.status-error td { background:#fff0f0; }
  tr.status-warn td { background:#fffbe6; }
  .badge { background:#000080; color:#fff; font-size:11px; padding:1px 6px; white-space:nowrap; }
  tr.status-pass .badge { background:#0b6b2f; }
  tr.status-warn .badge { background:#8a5a00; }
  tr.status-fail .badge, tr.status-error .badge { background:#9b1c1c; }
  tr.status-skip .badge { background:#666; }
  .detail { border-top:1px solid #ccc; padding:14px 0 4px; }
  .finding { font-size:15px; }
  pre { background:#f2f2f2; border:1px solid #ddd; padding:10px; white-space:pre-wrap; word-break:break-word; font:12px/1.45 Consolas, "Courier New", monospace; }
  .notice { border-left:4px solid #000080; background:#eef0fb; padding:10px 12px; margin:18px 0; }
  footer { border-top:1px solid #999; color:#555; font-size:12px; margin-top:30px; padding-top:10px; }
  @media print { body { padding:0; } .detail { break-inside:avoid; } }
</style>
</head>
<body>
<header>
  <h1>Feather AI Diagnostic Report</h1>
  <div>${escapeHtml(title)} — generated ${escapeHtml(formatDate(generatedAt))}</div>
</header>

<section>
  <h2>Computer</h2>
  <dl class="meta">
    <dt>Computer name</dt><dd>${escapeHtml(systemInfo.computerName || 'unknown')}</dd>
    <dt>Operating system</dt><dd>${escapeHtml(systemInfo.osName || 'unknown')}</dd>
    <dt>Details</dt><dd>${escapeHtml(systemInfo.osDetail || 'unknown')}</dd>
    <dt>Current user</dt><dd>${escapeHtml(systemInfo.user || 'unknown')}</dd>
    <dt>Administrator rights</dt><dd>${systemInfo.admin ? 'Yes' : 'No'}</dd>
    <dt>Mode</dt><dd>${escapeHtml(systemInfo.mode || 'Offline - local only')}</dd>
    <dt>Feather AI version</dt><dd>${escapeHtml(version)}</dd>
    <dt>Check started</dt><dd>${escapeHtml(formatDate(run.startedAt))}</dd>
    <dt>Check finished</dt><dd>${escapeHtml(formatDate(run.finishedAt))}</dd>
  </dl>
</section>

<section>
  <h2>Summary</h2>
  <table>
    <thead><tr><th>Total</th><th>Pass</th><th>Info</th><th>Warning</th><th>Fail</th><th>Error</th><th>Skipped</th></tr></thead>
    <tbody><tr>
      <td>${summary.total ?? results.length}</td><td>${summary.pass ?? 0}</td><td>${summary.info ?? 0}</td>
      <td>${summary.warn ?? 0}</td><td>${summary.fail ?? 0}</td><td>${summary.error ?? 0}</td><td>${summary.skip ?? 0}</td>
    </tr></tbody>
  </table>
  ${run.cancelled ? '<p class="notice"><strong>This check was cancelled before all selected items finished.</strong> The results below are only for items that completed.</p>' : ''}
  <p class="notice">A warning or failure is a measured condition, not proof that this computer is compromised. The evidence column shows the observed data. Interpret it with the explanation and next step for each item.</p>
</section>

<section>
  <h2>Results</h2>
  <table>
    <thead><tr><th style="width:24%">Check</th><th style="width:10%">Status</th><th>Finding</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</section>

<section>
  <h2>Evidence and guidance</h2>
  ${details}
</section>

<section>
  <h2>Repair actions in this session</h2>
  <table>
    <thead><tr><th>Action</th><th>Risk</th><th>Outcome</th><th>Started</th><th>Summary</th></tr></thead>
    <tbody>${repairRows}</tbody>
  </table>
</section>

<section>
  <h2>Audit trail</h2>
  <table>
    <thead><tr><th style="width:190px">Time</th><th style="width:180px">Event</th><th>Detail</th></tr></thead>
    <tbody>${auditRows}</tbody>
  </table>
</section>

<footer>
  Generated locally by Feather AI ${escapeHtml(version)}. This toolkit never uploads telemetry. Reports contain local system information; store them appropriately.
  Feather AI performs read-only checks unless you explicitly approve a repair. It is not a substitute for professional incident response or a full antivirus product.
</footer>
</body>
</html>`;
}

function buildTextReport({ tool, run, repairs = [], systemInfo = {}, version = '1.0.0', generatedAt = new Date().toISOString() }) {
  if (!run || !Array.isArray(run.results)) throw new Error('There are no check results to report.');
  const s = run.summary || {};
  const lines = [];
  lines.push('FEATHER AI DIAGNOSTIC REPORT');
  lines.push('='.repeat(72));
  lines.push(`Tool: ${tool?.title || 'Report'}`);
  lines.push(`Generated: ${formatDate(generatedAt)}`);
  lines.push(`Computer: ${systemInfo.computerName || 'unknown'}`);
  lines.push(`Operating system: ${systemInfo.osName || 'unknown'}`);
  lines.push(`Details: ${systemInfo.osDetail || 'unknown'}`);
  lines.push(`User: ${systemInfo.user || 'unknown'}`);
  lines.push(`Administrator: ${systemInfo.admin ? 'yes' : 'no'}`);
  lines.push(`Started: ${formatDate(run.startedAt)}`);
  lines.push(`Finished: ${formatDate(run.finishedAt)}`);
  lines.push('');
  lines.push(`SUMMARY: ${s.total ?? run.results.length} checks | pass ${s.pass ?? 0} | info ${s.info ?? 0} | warn ${s.warn ?? 0} | fail ${s.fail ?? 0} | error ${s.error ?? 0} | skipped ${s.skip ?? 0}`);
  if (run.cancelled) lines.push('NOTE: This check was cancelled before all selected items finished.');
  lines.push('');
  for (const r of run.results) {
    lines.push('-'.repeat(72));
    lines.push(`[${String(r.status).toUpperCase()}] ${r.name}`);
    lines.push(`Finding: ${r.finding}`);
    lines.push('Evidence:');
    lines.push(String(r.evidence).split('\n').map((l) => `  ${l}`).join('\n'));
    lines.push(`Explanation: ${r.explanation}`);
    lines.push(`Next step: ${r.nextStep}`);
    lines.push('');
  }
  lines.push('-'.repeat(72));
  lines.push('REPAIR ACTIONS IN THIS SESSION');
  if (!repairs.length) lines.push('  None.');
  for (const r of repairs) {
    lines.push(`  ${formatDate(r.startedAt)} | ${r.name || r.repairId} | risk ${r.risk || 'unknown'} | ${r.outcome || 'unknown'}`);
    if (r.summary) lines.push(`    ${r.summary}`);
  }
  lines.push('');
  lines.push('Generated locally by Feather AI. No telemetry was uploaded. This report is not proof of compromise and is not a substitute for professional incident response.');
  lines.push('');
  return lines.join('\n');
}

function reportFilename(tool, date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  const toolName = String(tool?.id || 'report').replace(/[^a-z0-9-]/gi, '');
  return `FeatherAI-${toolName}-${stamp}`;
}

function isInsideDirectory(dir, file) {
  const base = path.resolve(dir);
  const target = path.resolve(file);
  return target === base || target.startsWith(base + path.sep);
}

module.exports = { escapeHtml, buildReport, buildTextReport, reportFilename, isInsideDirectory, formatDate };
