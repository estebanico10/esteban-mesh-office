'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { ALL_DRIVE_LETTERS, getDriveLettersStatus, MountManager } = require('../electron/system-tools.cjs');
const { ConfigStore } = require('../electron/config-store.cjs');

test('drive-organizer & customization: 23 letters D:-Z:, status detection, mount organization & ConfigStore profiles', () => {
  assert.equal(ALL_DRIVE_LETTERS.length, 23);
  assert.equal(ALL_DRIVE_LETTERS[0], 'Z:');
  assert.equal(ALL_DRIVE_LETTERS[22], 'D:');
  assert.equal(ALL_DRIVE_LETTERS.includes('C:'), false);

  const mockMounts = new Map([
    ['Z:', { drive: 'Z:', alias: 'PC-Contabilidad', group: 'Contabilidad', nodeName: 'CONTA-01' }]
  ]);
  const info = getDriveLettersStatus(mockMounts, 'Y:');
  const zEntry = info.letters.find((l) => l.letter === 'Z:');
  assert.equal(zEntry.status, 'mounted-by-app');
  assert.equal(zEntry.group, 'Contabilidad');
  assert.notEqual(info.nextFreeLetter, 'Z:');

  const mgr = new MountManager();
  mgr.mounts.set('X:', { drive: 'X:', label: 'Old', alias: 'Old', group: 'General', color: 'emerald', proc: { kill() {} } });
  const org = mgr.updateMountOrganization('X:', { alias: '[PC-2] Disco D', group: 'Oficina', color: 'violet' });
  assert.equal(org.alias, '[PC-2] Disco D');
  assert.equal(org.group, 'Oficina');
  assert.equal(org.color, 'violet');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emo-drvorg-'));
  try {
    const store = new ConfigStore(path.join(tmpDir, 'config.json'));
    const cfg = store.updateSettings({
      uiTheme: 'violet',
      uiEffects: 'minimal',
      uiDensity: 'compact',
      uiScale: 'lg',
      resourceProfile: 'eco',
      preferredStartLetter: 'M:',
      autoAssignFreeDrive: true
    });
    assert.equal(cfg.uiTheme, 'violet');
    assert.equal(cfg.uiEffects, 'minimal');
    assert.equal(cfg.uiDensity, 'compact');
    assert.equal(cfg.preferredStartLetter, 'M:');

    const prof = store.saveDriveProfile({
      keyId: 'k1',
      nodeName: 'PC-Diseno',
      shareSubpath: 'Proyectos',
      alias: '[PC-Diseno] Proyectos',
      group: 'Diseño',
      color: 'rose',
      mountMode: 'folder'
    });
    assert.equal(store.getPublicConfig().driveProfiles.length, 1);
    assert.equal(prof.mountMode, 'folder');
    store.removeDriveProfile(prof.id);
    assert.equal(store.getPublicConfig().driveProfiles.length, 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
