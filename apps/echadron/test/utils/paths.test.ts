import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  getBinDir,
  getDataDir,
  getInputHistoryFile,
  getLogDir,
  getUpdateInstallStateFile,
  getUpdateStateFile,
} from '#/utils/paths';

const originalEnv = { ...process.env };

beforeEach(() => {
  delete process.env['ECHADRON_HOME'];
  delete process.env['ECHADRON_CODE_HOME'];
  delete process.env['IMPERIUM_HOME'];
  delete process.env['KIMI_CODE_HOME'];
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('getDataDir', () => {
  it('returns ~/.echadron when ECHADRON_HOME is not set', () => {
    expect(getDataDir()).toBe(join(homedir(), '.echadron'));
  });

  it('prefers ECHADRON_HOME over compatibility aliases', () => {
    process.env['ECHADRON_HOME'] = '/tmp/echadron-home';
    process.env['ECHADRON_CODE_HOME'] = '/tmp/echadron-code-home';
    process.env['IMPERIUM_HOME'] = '/tmp/legacy-home';
    expect(getDataDir()).toBe('/tmp/echadron-home');
  });

  it('returns IMPERIUM_HOME when set', () => {
    process.env['IMPERIUM_HOME'] = '/tmp/echadron-test-data';
    expect(getDataDir()).toBe('/tmp/echadron-test-data');
  });

  it('uses the ACP/web compatibility alias before legacy homes', () => {
    process.env['ECHADRON_CODE_HOME'] = '/tmp/echadron-code-home';
    process.env['IMPERIUM_HOME'] = '/tmp/legacy-home';
    expect(getDataDir()).toBe('/tmp/echadron-code-home');
  });

  it('returns IMPERIUM_HOME even if it is a relative path', () => {
    process.env['IMPERIUM_HOME'] = 'relative/path';
    expect(getDataDir()).toBe('relative/path');
  });
});

describe('getLogDir', () => {
  it('returns <dataDir>/logs', () => {
    expect(getLogDir()).toBe(join(homedir(), '.echadron', 'logs'));
  });

  it('respects IMPERIUM_HOME', () => {
    process.env['IMPERIUM_HOME'] = '/z';
    expect(getLogDir()).toBe(join('/z', 'logs'));
  });
});

describe('getBinDir', () => {
  it('returns <dataDir>/bin', () => {
    expect(getBinDir()).toBe(join(homedir(), '.echadron', 'bin'));
  });

  it('respects IMPERIUM_HOME', () => {
    process.env['IMPERIUM_HOME'] = '/custom-bin-home';
    expect(getBinDir()).toBe(join('/custom-bin-home', 'bin'));
  });
});

describe('getUpdateStateFile', () => {
  it('returns <dataDir>/updates/latest.json', () => {
    expect(getUpdateStateFile()).toBe(join(homedir(), '.echadron', 'updates', 'latest.json'));
  });

  it('respects IMPERIUM_HOME', () => {
    process.env['IMPERIUM_HOME'] = '/updates-home';
    expect(getUpdateStateFile()).toBe(join('/updates-home', 'updates', 'latest.json'));
  });
});

describe('getUpdateInstallStateFile', () => {
  it('returns <dataDir>/updates/install.json', () => {
    expect(getUpdateInstallStateFile()).toBe(
      join(homedir(), '.echadron', 'updates', 'install.json'),
    );
  });

  it('respects IMPERIUM_HOME', () => {
    process.env['IMPERIUM_HOME'] = '/updates-home';
    expect(getUpdateInstallStateFile()).toBe(join('/updates-home', 'updates', 'install.json'));
  });
});

describe('getInputHistoryFile', () => {
  it('returns <dataDir>/user-history/<md5(workDir)>.jsonl', () => {
    const workDir = '/home/user/project';
    const hash = createHash('md5').update(workDir, 'utf-8').digest('hex');
    expect(getInputHistoryFile(workDir)).toBe(
      join(homedir(), '.echadron', 'user-history', `${hash}.jsonl`),
    );
  });

  it('respects IMPERIUM_HOME', () => {
    process.env['IMPERIUM_HOME'] = '/custom/data';
    const hash = createHash('md5').update('/proj', 'utf-8').digest('hex');
    expect(getInputHistoryFile('/proj')).toBe(
      join('/custom/data', 'user-history', `${hash}.jsonl`),
    );
  });
});
