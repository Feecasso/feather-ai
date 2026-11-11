'use strict';

/**
 * electron-builder afterPack hook.
 *
 * Adds the plain-text README, license, documentation, and a writable reports
 * folder next to the packaged executable so a copied build is self-describing
 * (and usable from a USB drive) without an installer.
 */

const fs = require('node:fs');
const path = require('node:path');

function copyFile(from, to) {
  try {
    if (fs.existsSync(from)) fs.copyFileSync(from, to);
  } catch (error) {
    console.warn(`afterPack: could not copy ${path.basename(from)}: ${error.message}`);
  }
}

function copyDir(from, to) {
  try {
    if (!fs.existsSync(from)) return;
    fs.cpSync(from, to, { recursive: true });
  } catch (error) {
    console.warn(`afterPack: could not copy docs: ${error.message}`);
  }
}

module.exports = async function afterPack(context) {
  const root = path.resolve(__dirname, '..');
  const out = context.appOutDir;
  if (!out || !fs.existsSync(out)) return;

  copyFile(path.join(root, 'README.txt'), path.join(out, 'README.txt'));
  copyFile(path.join(root, 'LICENSE'), path.join(out, 'LICENSE.txt'));
  copyDir(path.join(root, 'docs'), path.join(out, 'docs'));

  const reports = path.join(out, 'reports');
  try {
    fs.mkdirSync(reports, { recursive: true });
    fs.writeFileSync(
      path.join(reports, 'README.txt'),
      [
        'Feather AI reports and the local audit log are written to this folder',
        'when it is writable.',
        '',
        'If the USB drive or program folder is read-only, reports are written to',
        'the current user\'s Documents folder instead. The status bar in the',
        'application always shows the last saved location.',
        ''
      ].join('\n'),
      { flag: 'wx' }
    );
  } catch {
    /* folder already exists or is not writable; runtime handles fallback */
  }
};
