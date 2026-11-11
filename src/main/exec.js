'use strict';

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MAX_OUTPUT = 1024 * 1024; // 1 MiB per stream
const KILL_GRACE_MS = 3000;

/** Kill a process and, where possible, its children. */
function killTree(child) {
  if (!child || child.killed || child.exitCode !== null) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 10000 });
    } else {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        child.kill('SIGTERM');
      }
      setTimeout(() => {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          try {
            child.kill('SIGKILL');
          } catch {
            /* already gone */
          }
        }
      }, KILL_GRACE_MS).unref?.();
    }
  } catch {
    /* the child may have exited between checks */
  }
}

/**
 * Run a fixed executable with an argument array. Never accepts a shell string.
 * Returns output even on a non-zero exit code so callers can explain failures.
 */
function run(file, args = [], options = {}) {
  const {
    timeout = 30000,
    signal,
    cwd,
    env,
    detached = process.platform !== 'win32',
    maxOutput = MAX_OUTPUT
  } = options;

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let outBytes = 0;
    let errBytes = 0;
    let timedOut = false;
    let aborted = false;
    let settled = false;
    let killTimer = null;

    const child = spawn(file, args, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      windowsHide: true,
      detached,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    if (!child.pid) {
      resolve({
        ok: false,
        code: null,
        signal: null,
        stdout: '',
        stderr: `Unable to start ${path.basename(file)}.`,
        timedOut: false,
        aborted: false,
        error: 'spawn-failed'
      });
      return;
    }

    const finish = (extra = {}) => {
      if (settled) return;
      settled = true;
      if (killTimer) clearTimeout(killTimer);
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve({
        ok: extra.code === 0 && !timedOut && !aborted,
        code: extra.code ?? null,
        signal: extra.signal ?? null,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        timedOut,
        aborted,
        ...extra
      });
    };

    const onAbort = () => {
      aborted = true;
      killTree(child);
    };

    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }

    if (timeout > 0) {
      killTimer = setTimeout(() => {
        timedOut = true;
        killTree(child);
      }, timeout);
      killTimer.unref?.();
    }

    child.stdout?.on('data', (chunk) => {
      if (outBytes >= maxOutput) return;
      outBytes += chunk.length;
      stdout += chunk.toString('utf8');
      if (outBytes >= maxOutput) {
        stdout += `\n[output truncated at ${maxOutput} bytes]`;
      }
    });
    child.stderr?.on('data', (chunk) => {
      if (errBytes >= maxOutput) return;
      errBytes += chunk.length;
      stderr += chunk.toString('utf8');
      if (errBytes >= maxOutput) {
        stderr += `\n[output truncated at ${maxOutput} bytes]`;
      }
    });

    child.on('error', (error) => {
      stderr += `${stderr ? '\n' : ''}${error.message}`;
      finish({ code: null, error: error.code || error.message });
    });
    child.on('close', (code, sig) => finish({ code, signal: sig }));
  });
}

/** Run a fixed PowerShell script without a visible console window. */
async function runPowerShell(script, options = {}) {
  if (process.platform !== 'win32') {
    throw Object.assign(new Error('PowerShell is only used on Windows.'), { code: 'WRONG_PLATFORM' });
  }
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const result = await run(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    options
  );
  return result;
}

/** Parse the last JSON value emitted by a script. */
function parseJson(text) {
  if (!text) return null;
  const cleaned = String(text).replace(/^\uFEFF/, '').trim();
  if (!cleaned) return null;
  try {
    return JSON.parse(cleaned);
  } catch {
    // Some Windows tools prepend warnings. Try the last JSON object/array line.
    const lines = cleaned.split(/\r?\n/).reverse();
    for (const line of lines) {
      const candidate = line.trim();
      if (!candidate || (!candidate.startsWith('{') && !candidate.startsWith('['))) continue;
      try {
        return JSON.parse(candidate);
      } catch {
        /* keep looking */
      }
    }
    return null;
  }
}

function psQuote(value) {
  return String(value).replace(/'/g, "''");
}

function tempDir(prefix = 'feather-ai-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * Run a PowerShell script elevated through the Windows UAC dialog.
 * The visible Feather AI window stays open; the elevated helper window is hidden.
 */
async function runElevatedPowerShell(script, options = {}) {
  if (process.platform !== 'win32') {
    throw Object.assign(new Error('UAC is only available on Windows.'), { code: 'WRONG_PLATFORM' });
  }
  const dir = tempDir('feather-ai-elevated-');
  const scriptPath = path.join(dir, 'task.ps1');
  const resultPath = path.join(dir, 'result.json');
  const launcherPath = path.join(dir, 'launch.ps1');
  const body = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
  $data = & {
${script}
  }
  @{ ok = $true; data = $data } | ConvertTo-Json -Depth 12 -Compress | Set-Content -LiteralPath '${psQuote(resultPath)}' -Encoding UTF8
} catch {
  @{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress | Set-Content -LiteralPath '${psQuote(resultPath)}' -Encoding UTF8
  exit 1
}
`;
  const launcher = `
$ErrorActionPreference = 'Stop'
try {
  $p = Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList @('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File','${psQuote(scriptPath)}')
  exit $p.ExitCode
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1223
}
`;
  fs.writeFileSync(scriptPath, body, 'utf8');
  fs.writeFileSync(launcherPath, launcher, 'utf8');

  const result = await run(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', launcherPath],
    { ...options, timeout: (options.timeout || 60000) + 90000 }
  );

  let parsed = null;
  if (fs.existsSync(resultPath)) {
    parsed = parseJson(fs.readFileSync(resultPath, 'utf8'));
  }
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }

  if (result.timedOut) {
    return { ...result, parsed: null, userCancelled: false, message: 'The elevated operation timed out.' };
  }
  if (result.code === 1223 || /canceled by the user|cancelled by the user/i.test(result.stderr)) {
    return {
      ...result,
      parsed: null,
      userCancelled: true,
      message: 'Administrator approval was cancelled. The action did not run.'
    };
  }
  if (!parsed) {
    return {
      ...result,
      parsed: null,
      userCancelled: false,
      message: result.stderr || 'The elevated helper did not return a result.'
    };
  }
  return { ...result, parsed, userCancelled: false, ok: result.code === 0 && parsed.ok === true };
}

/**
 * Run a shell script with Linux privilege elevation (PolicyKit, cached sudo, or
 * direct root). The script writes its JSON result to a temporary file so
 * terminal output is not required.
 */
async function runElevatedShell(script, options = {}) {
  if (process.platform === 'win32') {
    throw Object.assign(new Error('PolicyKit is only used on Linux.'), { code: 'WRONG_PLATFORM' });
  }
  const dir = tempDir('feather-ai-elevated-');
  const scriptPath = path.join(dir, 'task.sh');
  const resultPath = path.join(dir, 'result.json');
  const wrapped = `#!/bin/sh
umask 022
{
${script}
} > '${resultPath.replace(/'/g, "'\\''")}' 2>&1
rc=$?
chmod 0644 '${resultPath.replace(/'/g, "'\\''")}' 2>/dev/null
exit $rc
`;
  fs.writeFileSync(scriptPath, wrapped, { mode: 0o755 });
  fs.chmodSync(scriptPath, 0o755);

  let command = null;
  let args = [];
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    command = '/bin/sh';
    args = [scriptPath];
  } else if (fs.existsSync('/usr/bin/pkexec')) {
    command = '/usr/bin/pkexec';
    args = ['/bin/sh', scriptPath];
  } else {
    const sudoCheck = spawnSync('sudo', ['-n', 'true'], { timeout: 5000, windowsHide: true });
    if (sudoCheck.status === 0) {
      command = 'sudo';
      args = ['-n', '/bin/sh', scriptPath];
    }
  }

  if (!command) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    return {
      ok: false,
      parsed: null,
      userCancelled: false,
      code: 'NO_ELEVATION',
      message:
        'Administrator approval needs PolicyKit (pkexec) or passwordless sudo. It was not available. Run Feather AI as root or install a PolicyKit authentication agent.'
    };
  }

  const result = await run(command, args, { ...options, env: { ...options.env, DISPLAY: process.env.DISPLAY || ':0' } });
  let raw = '';
  if (fs.existsSync(resultPath)) {
    try {
      raw = fs.readFileSync(resultPath, 'utf8');
    } catch {
      raw = '';
    }
  }
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  const output = raw.trim() || result.stdout;
  const parsed = parseJson(output);
  const userCancelled = /Not authorized|dismissed|Authentication failed|Request dismissed/i.test(
    `${result.stderr} ${result.stdout} ${raw}`
  );
  return {
    ...result,
    parsed,
    userCancelled,
    stdout: output,
    message: userCancelled
      ? 'Administrator approval was cancelled. The action did not run.'
      : parsed
        ? ''
        : output || result.stderr || 'The elevated helper returned no output.'
  };
}

module.exports = {
  run,
  runPowerShell,
  runElevatedPowerShell,
  runElevatedShell,
  parseJson,
  killTree,
  psQuote,
  tempDir
};
