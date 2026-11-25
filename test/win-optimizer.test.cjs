'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  getOptimizerCatalog,
  buildWinScript,
  exportWinScriptFile
} = require('../electron/win-optimizer.cjs');

test('win-optimizer: catalog exposes tweaks/presets without raw script fields and builds safe apply/revert scripts', () => {
  const catalog = getOptimizerCatalog();
  assert.ok(Array.isArray(catalog.tweaks) && catalog.tweaks.length >= 15);
  assert.ok(Array.isArray(catalog.presets) && catalog.presets.length >= 3);
  for (const t of catalog.tweaks) {
    assert.equal(t.applyPs, undefined);
    assert.equal(t.revertPs, undefined);
  }

  const ecoPreset = catalog.presets.find((p) => p.id === 'eco-office');
  assert.ok(ecoPreset);
  const ecoBuilt = buildWinScript({ tweakIds: ecoPreset.tweakIds, mode: 'apply', appName: 'Esteban Mesh Office' });
  assert.equal(ecoBuilt.requiresAdmin, false);
  assert.equal(ecoBuilt.selectedCount, ecoPreset.tweakIds.length);
  assert.match(ecoBuilt.script, /WIN_OPTIMIZER_DONE/);

  const maxPreset = catalog.presets.find((p) => p.id === 'max-performance');
  const maxBuilt = buildWinScript({ tweakIds: maxPreset.tweakIds, mode: 'apply', appName: 'Esteban Mesh Office' });
  assert.equal(maxBuilt.requiresAdmin, true);

  const revertBuilt = buildWinScript({ tweakIds: ['perf-visual-effects', 'clean-user-temp'], mode: 'revert' });
  assert.equal(revertBuilt.selectedCount, 1);
  assert.deepEqual(revertBuilt.selectedIds, ['perf-visual-effects']);
  assert.match(revertBuilt.script, /RESTAURAR VALORES/);

  assert.throws(() => buildWinScript({ tweakIds: ['evil; rm -rf /'] }), /no permitida/i);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emo-winopt-'));
  try {
    const dest = path.join(tmpDir, 'test.ps1');
    const exp = exportWinScriptFile({ tweakIds: ['clean-dns-cache'], destPath: dest });
    assert.equal(exp.ok, true);
    const raw = fs.readFileSync(dest, 'utf8');
    assert.ok(raw.startsWith('\uFEFF'));
    assert.match(raw, /ipconfig \/flushdns/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
