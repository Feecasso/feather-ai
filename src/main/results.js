'use strict';

const STATUS = {
  pass: { label: 'Pass', severity: 0, description: 'The measured value is within the documented range.' },
  info: { label: 'Info', severity: 1, description: 'Information only. No problem was determined.' },
  warn: { label: 'Warning', severity: 2, description: 'A weakness or unusual condition needs review.' },
  fail: { label: 'Fail', severity: 3, description: 'A security-relevant condition failed the check.' },
  error: { label: 'Error', severity: 3, description: 'The check could not complete.' },
  skip: { label: 'Skipped', severity: 0, description: 'The check does not apply or is unavailable.' }
};

function clampText(value, max = 12000) {
  const text = String(value ?? '');
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n[...truncated ${text.length - max} characters]`;
}

/**
 * Normalize a check result. Every result shown in the UI comes through here.
 * "evidence" is raw observed data; "explanation" and "nextStep" are guidance.
 */
function makeResult(check, data = {}) {
  const status = Object.prototype.hasOwnProperty.call(STATUS, data.status) ? data.status : 'info';
  return {
    id: check.id,
    name: check.name,
    tool: check.tool,
    status,
    finding: clampText(data.finding || 'No finding recorded.', 500),
    evidence: clampText(data.evidence || 'No evidence was returned.', 12000),
    explanation: clampText(data.explanation || STATUS[status].description, 2000),
    nextStep: clampText(data.nextStep || 'No action is required for this result.', 2000),
    durationMs: Number.isFinite(data.durationMs) ? Math.round(data.durationMs) : 0,
    measuredAt: data.measuredAt || new Date().toISOString()
  };
}

function summarize(results = []) {
  const counts = { pass: 0, info: 0, warn: 0, fail: 0, error: 0, skip: 0 };
  for (const result of results) {
    if (counts[result.status] !== undefined) counts[result.status] += 1;
  }
  const attention = counts.warn + counts.fail + counts.error;
  return { total: results.length, ...counts, attention };
}

function overallStatus(results = []) {
  if (!results.length) return 'info';
  if (results.some((r) => r.status === 'fail' || r.status === 'error')) return 'fail';
  if (results.some((r) => r.status === 'warn')) return 'warn';
  if (results.some((r) => r.status === 'pass')) return 'pass';
  return 'info';
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return 'unknown';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return `${minutes} min ${seconds} s`;
}

module.exports = { STATUS, makeResult, summarize, overallStatus, formatDuration, clampText };
