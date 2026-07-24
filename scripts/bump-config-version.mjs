import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CONFIG_PATH = 'packages/types/src/index.ts';
const CHANGESETS_CONFIG_PATH = '.changeset/config.json';
const VERSION_STATE_PATH = '.changeset/.version-packages-state.json';
const PACKAGES_PATH = 'packages';
const PATTERN = /(CONFIG_VERSION\s*=\s*)(\d+)/;
const STATE_SCHEMA_VERSION = 1;

const readFixedPackageNames = workspaceRoot => {
  const configPath = join(workspaceRoot, CHANGESETS_CONFIG_PATH);
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const names = config.fixed?.flat();

  if (!Array.isArray(names) || names.length === 0 || names.some(name => typeof name !== 'string')) {
    throw new Error(`could not find a valid fixed package group in ${configPath}`);
  }

  return [...new Set(names)];
};

const readPackageVersions = (workspaceRoot, packageNames) => {
  const packagesPath = join(workspaceRoot, PACKAGES_PATH);
  const expectedNames = new Set(packageNames);
  const versions = new Map();

  for (const entry of readdirSync(packagesPath, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const manifestPath = join(packagesPath, entry.name, 'package.json');
    let manifest;

    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') {
        continue;
      }
      throw error;
    }

    if (expectedNames.has(manifest.name)) {
      if (typeof manifest.version !== 'string' || manifest.version.length === 0) {
        throw new Error(`could not find a valid version in ${manifestPath}`);
      }
      versions.set(manifest.name, manifest.version);
    }
  }

  const missingNames = packageNames.filter(name => !versions.has(name));
  if (missingNames.length > 0) {
    throw new Error(`could not find package manifests for: ${missingNames.join(', ')}`);
  }

  return versions;
};

const runChangesetVersion = workspaceRoot => {
  const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const result = spawnSync(command, ['exec', 'changeset', 'version'], {
    cwd: workspaceRoot,
    env: process.env,
    stdio: 'inherit',
  });

  if (result.error) {
    throw new Error(`could not run changeset version: ${result.error.message}`);
  }

  if (result.status !== 0) {
    const detail = result.signal ? `signal ${result.signal}` : `exit code ${result.status}`;
    const error = new Error(`changeset version failed with ${detail}`);
    error.exitCode = result.status ?? 1;
    throw error;
  }
};

const readConfigVersion = workspaceRoot => {
  const configPath = join(workspaceRoot, CONFIG_PATH);
  const source = readFileSync(configPath, 'utf8');
  const match = source.match(PATTERN);

  if (!match) {
    throw new Error(`could not find CONFIG_VERSION in ${configPath}`);
  }

  const current = Number(match[2]);
  if (!Number.isSafeInteger(current)) {
    throw new Error(`could not find a safe integer CONFIG_VERSION in ${configPath}`);
  }

  return { configPath, current, source };
};

const ensureConfigVersionIncremented = (workspaceRoot, expectedCurrent) => {
  const { configPath, current, source } = readConfigVersion(workspaceRoot);
  const next = current + 1;

  if (current === expectedCurrent + 1) {
    return { current: expectedCurrent, next: current, incremented: false };
  }

  if (current !== expectedCurrent) {
    throw new Error(
      `CONFIG_VERSION changed unexpectedly in ${configPath}: expected ${expectedCurrent} or ${expectedCurrent + 1}, found ${current}`,
    );
  }

  writeFileSync(
    configPath,
    source.replace(PATTERN, (_match, prefix) => `${prefix}${next}`),
  );

  return { current, next, incremented: true };
};

const statePathFor = workspaceRoot => join(workspaceRoot, VERSION_STATE_PATH);

const validateVersionState = (state, statePath) => {
  const validPhase = state?.phase === 'prepared' || state?.phase === 'versioned';
  const validPackageVersions =
    state?.packageVersions &&
    typeof state.packageVersions === 'object' &&
    !Array.isArray(state.packageVersions) &&
    Object.entries(state.packageVersions).every(
      ([name, version]) => typeof name === 'string' && typeof version === 'string',
    );

  if (
    state?.schemaVersion !== STATE_SCHEMA_VERSION ||
    !validPhase ||
    !Number.isSafeInteger(state?.configVersion) ||
    !validPackageVersions
  ) {
    throw new Error(`could not read valid version recovery state from ${statePath}`);
  }

  return state;
};

const readVersionState = workspaceRoot => {
  const statePath = statePathFor(workspaceRoot);
  if (!existsSync(statePath)) {
    return undefined;
  }

  let state;
  try {
    state = JSON.parse(readFileSync(statePath, 'utf8'));
  } catch {
    throw new Error(`could not read valid version recovery state from ${statePath}`);
  }

  return validateVersionState(state, statePath);
};

const writeVersionState = (workspaceRoot, state, { exclusive = false } = {}) => {
  const statePath = statePathFor(workspaceRoot);
  const serialized = `${JSON.stringify(state, null, 2)}\n`;

  if (exclusive) {
    writeFileSync(statePath, serialized, { flag: 'wx' });
    return;
  }

  const temporaryPath = `${statePath}.${process.pid}.tmp`;
  try {
    writeFileSync(temporaryPath, serialized, { flag: 'wx' });
    renameSync(temporaryPath, statePath);
  } finally {
    if (existsSync(temporaryPath)) {
      unlinkSync(temporaryPath);
    }
  }
};

const removeVersionState = workspaceRoot => {
  unlinkSync(statePathFor(workspaceRoot));
};

const packageVersionsFromState = (state, packageNames, statePath) => {
  const savedNames = Object.keys(state.packageVersions).sort();
  const expectedNames = [...packageNames].sort();

  if (savedNames.length !== expectedNames.length || savedNames.some((name, index) => name !== expectedNames[index])) {
    throw new Error(`fixed package group no longer matches version recovery state in ${statePath}`);
  }

  return new Map(packageNames.map(name => [name, state.packageVersions[name]]));
};

const findVersionedPackages = (packageNames, versionsBefore, versionsAfter) =>
  packageNames.filter(name => versionsBefore.get(name) !== versionsAfter.get(name));

const createVersionState = (workspaceRoot, packageNames) => {
  const packageVersions = readPackageVersions(workspaceRoot, packageNames);
  const { current: configVersion } = readConfigVersion(workspaceRoot);
  const state = {
    schemaVersion: STATE_SCHEMA_VERSION,
    phase: 'prepared',
    configVersion,
    packageVersions: Object.fromEntries(packageVersions),
  };

  writeVersionState(workspaceRoot, state, { exclusive: true });
  return state;
};

export const versionPackages = ({
  workspaceRoot = process.cwd(),
  versionPackagesWithChangesets = runChangesetVersion,
  log = console.log,
} = {}) => {
  const packageNames = readFixedPackageNames(workspaceRoot);
  const recoveryStatePath = statePathFor(workspaceRoot);
  let state = readVersionState(workspaceRoot) ?? createVersionState(workspaceRoot, packageNames);
  const versionsBefore = packageVersionsFromState(state, packageNames, recoveryStatePath);
  let versionsAfter;
  let versionedPackages;

  if (state.phase === 'prepared') {
    versionPackagesWithChangesets(workspaceRoot);
    versionsAfter = readPackageVersions(workspaceRoot, packageNames);
    versionedPackages = findVersionedPackages(packageNames, versionsBefore, versionsAfter);

    if (versionedPackages.length === 0) {
      removeVersionState(workspaceRoot);
      log('No package versions changed; CONFIG_VERSION was not incremented.');
      return { bumped: false, versionedPackages };
    }

    state = { ...state, phase: 'versioned' };
    writeVersionState(workspaceRoot, state);
  } else {
    versionsAfter = readPackageVersions(workspaceRoot, packageNames);
    versionedPackages = findVersionedPackages(packageNames, versionsBefore, versionsAfter);
  }

  if (versionedPackages.length === 0) {
    throw new Error(`version recovery state in ${recoveryStatePath} has no package version changes to recover`);
  }

  const { current, next, incremented } = ensureConfigVersionIncremented(workspaceRoot, state.configVersion);
  removeVersionState(workspaceRoot);
  log(
    incremented
      ? `  ${CONFIG_PATH} → CONFIG_VERSION ${current} → ${next}`
      : `  ${CONFIG_PATH} → CONFIG_VERSION ${next} already applied; recovery completed`,
  );

  return { bumped: incremented, versionedPackages };
};

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  try {
    versionPackages();
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = Number.isInteger(error?.exitCode) ? error.exitCode : 1;
  }
}
