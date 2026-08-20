import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { versionPackages } from './bump-config-version.mjs';

const PACKAGE_NAMES = ['@sodax/types', '@sodax/sdk'];
const VERSION_STATE_PATH = '.changeset/.version-packages-state.json';

const writeJson = (path, value) => {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};

const createWorkspace = t => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'bump-config-version-'));
  t.after(() => rmSync(workspaceRoot, { recursive: true, force: true }));

  mkdirSync(join(workspaceRoot, '.changeset'), { recursive: true });
  mkdirSync(join(workspaceRoot, 'packages/types/src'), { recursive: true });
  mkdirSync(join(workspaceRoot, 'packages/sdk'), { recursive: true });

  writeJson(join(workspaceRoot, '.changeset/config.json'), { fixed: [PACKAGE_NAMES] });
  writeJson(join(workspaceRoot, 'packages/types/package.json'), {
    name: '@sodax/types',
    version: '1.0.0',
  });
  writeJson(join(workspaceRoot, 'packages/sdk/package.json'), {
    name: '@sodax/sdk',
    version: '1.0.0',
  });
  writeFileSync(join(workspaceRoot, 'packages/types/src/index.ts'), 'export const CONFIG_VERSION = 100;\n');

  return workspaceRoot;
};

test('skips CONFIG_VERSION when changeset version is a no-op', t => {
  const workspaceRoot = createWorkspace(t);
  const messages = [];

  const result = versionPackages({
    workspaceRoot,
    versionPackagesWithChangesets: () => {},
    log: message => messages.push(message),
  });

  assert.deepEqual(result, { bumped: false, versionedPackages: [] });
  assert.equal(
    readFileSync(join(workspaceRoot, 'packages/types/src/index.ts'), 'utf8'),
    'export const CONFIG_VERSION = 100;\n',
  );
  assert.equal(existsSync(join(workspaceRoot, VERSION_STATE_PATH)), false);
  assert.deepEqual(messages, ['No package versions changed; CONFIG_VERSION was not incremented.']);
});

test('increments CONFIG_VERSION once when changeset version changes package versions', t => {
  const workspaceRoot = createWorkspace(t);

  const result = versionPackages({
    workspaceRoot,
    versionPackagesWithChangesets: () => {
      for (const packageName of ['types', 'sdk']) {
        const manifestPath = join(workspaceRoot, `packages/${packageName}/package.json`);
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
        writeJson(manifestPath, { ...manifest, version: '1.1.0' });
      }
    },
    log: () => {},
  });

  assert.deepEqual(result, { bumped: true, versionedPackages: PACKAGE_NAMES });
  assert.equal(
    readFileSync(join(workspaceRoot, 'packages/types/src/index.ts'), 'utf8'),
    'export const CONFIG_VERSION = 101;\n',
  );
  assert.equal(existsSync(join(workspaceRoot, VERSION_STATE_PATH)), false);
});

test('does not increment CONFIG_VERSION when changeset version fails', t => {
  const workspaceRoot = createWorkspace(t);

  assert.throws(
    () =>
      versionPackages({
        workspaceRoot,
        versionPackagesWithChangesets: () => {
          throw new Error('changeset failed');
        },
        log: () => {},
      }),
    /changeset failed/,
  );
  assert.equal(
    readFileSync(join(workspaceRoot, 'packages/types/src/index.ts'), 'utf8'),
    'export const CONFIG_VERSION = 100;\n',
  );
  assert.equal(existsSync(join(workspaceRoot, VERSION_STATE_PATH)), true);
});

test('validates CONFIG_VERSION before running changeset version', t => {
  const workspaceRoot = createWorkspace(t);
  let changesetsCalled = false;
  writeFileSync(join(workspaceRoot, 'packages/types/src/index.ts'), 'export const OTHER_VERSION = 100;\n');

  assert.throws(
    () =>
      versionPackages({
        workspaceRoot,
        versionPackagesWithChangesets: () => {
          changesetsCalled = true;
        },
        log: () => {},
      }),
    /could not find CONFIG_VERSION/,
  );
  assert.equal(changesetsCalled, false);
  assert.equal(existsSync(join(workspaceRoot, VERSION_STATE_PATH)), false);
});

test('recovers a package version change left by a failed changeset run', t => {
  const workspaceRoot = createWorkspace(t);

  assert.throws(
    () =>
      versionPackages({
        workspaceRoot,
        versionPackagesWithChangesets: () => {
          for (const packageName of ['types', 'sdk']) {
            const manifestPath = join(workspaceRoot, `packages/${packageName}/package.json`);
            const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
            writeJson(manifestPath, { ...manifest, version: '1.1.0' });
          }
          throw new Error('interrupted after versioning packages');
        },
        log: () => {},
      }),
    /interrupted after versioning packages/,
  );

  assert.equal(existsSync(join(workspaceRoot, VERSION_STATE_PATH)), true);
  const result = versionPackages({
    workspaceRoot,
    versionPackagesWithChangesets: () => {},
    log: () => {},
  });

  assert.deepEqual(result, { bumped: true, versionedPackages: PACKAGE_NAMES });
  assert.equal(
    readFileSync(join(workspaceRoot, 'packages/types/src/index.ts'), 'utf8'),
    'export const CONFIG_VERSION = 101;\n',
  );
  assert.equal(existsSync(join(workspaceRoot, VERSION_STATE_PATH)), false);
});

test('does not increment CONFIG_VERSION twice when recovering after the bump was written', t => {
  const workspaceRoot = createWorkspace(t);
  for (const packageName of ['types', 'sdk']) {
    const manifestPath = join(workspaceRoot, `packages/${packageName}/package.json`);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    writeJson(manifestPath, { ...manifest, version: '1.1.0' });
  }
  writeFileSync(join(workspaceRoot, 'packages/types/src/index.ts'), 'export const CONFIG_VERSION = 101;\n');
  writeJson(join(workspaceRoot, VERSION_STATE_PATH), {
    schemaVersion: 1,
    phase: 'versioned',
    configVersion: 100,
    packageVersions: {
      '@sodax/types': '1.0.0',
      '@sodax/sdk': '1.0.0',
    },
  });

  let changesetsCalled = false;
  const result = versionPackages({
    workspaceRoot,
    versionPackagesWithChangesets: () => {
      changesetsCalled = true;
    },
    log: () => {},
  });

  assert.deepEqual(result, { bumped: false, versionedPackages: PACKAGE_NAMES });
  assert.equal(changesetsCalled, false);
  assert.equal(
    readFileSync(join(workspaceRoot, 'packages/types/src/index.ts'), 'utf8'),
    'export const CONFIG_VERSION = 101;\n',
  );
  assert.equal(existsSync(join(workspaceRoot, VERSION_STATE_PATH)), false);
});
