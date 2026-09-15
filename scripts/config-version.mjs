#!/usr/bin/env node
// The release-time mirror of the CONFIG_VERSION encoding. `@sodax/types` owns the normative
// implementation (packages/types/src/index.ts); this copy exists only because the release tooling is
// plain .mjs that runs before anything is built, so it cannot import the package. The two are pinned
// to the same committed constant from opposite directions by configVersionDriftErrors here and by
// the SDK_VERSION assertion in packages/types/src/config-version.test.ts.
//
// CLI:
//   node scripts/config-version.mjs <version>   prints the integer for that version
//   node scripts/config-version.mjs --check     exits 1 if the committed constant and manifest disagree
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-rc\.(0|[1-9]\d*))?$/;

// Anchored so a decoy such as `MIN_CONFIG_VERSION` cannot be read or rewritten in its place.
export const CONFIG_VERSION_PATTERN = /^export const CONFIG_VERSION = (\d[\d_]*);/m;

export const MANIFEST_PATH = 'packages/types/package.json';
export const CONFIG_PATH = 'packages/types/src/index.ts';

/** Highest rc slot, reserved for a stable release so it outranks every rc of the same triple. */
const RC_STABLE = 99;
export const MIN_CONFIG_VERSION = 1_000_000;
export const MAX_CONFIG_VERSION = 99_999_999;

export const parseVersion = value => {
  if (typeof value !== 'string') return null;
  const match = value.match(VERSION_PATTERN);
  if (!match) return null;
  return {
    raw: value,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    rc: match[4] === undefined ? null : Number(match[4]),
  };
};

export const compareVersions = (leftValue, rightValue) => {
  const left = typeof leftValue === 'string' ? parseVersion(leftValue) : leftValue;
  const right = typeof rightValue === 'string' ? parseVersion(rightValue) : rightValue;
  if (!left || !right) throw new Error('cannot compare invalid versions');

  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] - right[key];
  }
  if (left.rc === right.rc) return 0;
  if (left.rc === null) return 1;
  if (right.rc === null) return -1;
  return left.rc - right.rc;
};

// Each field is capped rather than truncated: one past any boundary the packing carries into the
// next field and silently collides with a different release, which nothing would surface at runtime.
const rangeErrors = ({ major, minor, patch, rc }) => {
  const errors = [];
  if (major < 1 || major > 99) errors.push(`major ${major} outside 1..99`);
  if (minor > 99) errors.push(`minor ${minor} outside 0..99`);
  if (patch > 99) errors.push(`patch ${patch} outside 0..99 (bump the minor instead)`);
  if (rc !== null && rc > 98) errors.push(`rc ${rc} outside 0..98 (99 is reserved for stable)`);
  return errors;
};

/** Total: `null` for anything outside the grammar or the domain. Mirrors `configVersionFor` in @sodax/types. */
export const configVersionFor = version => {
  const parsed = parseVersion(version);
  if (!parsed || rangeErrors(parsed).length > 0) return null;
  const { major, minor, patch, rc } = parsed;
  return major * 1_000_000 + minor * 10_000 + patch * 100 + (rc === null ? RC_STABLE : rc);
};

/**
 * The release-time front door: a bad number must stop a release, and the message is the operator's
 * only guidance mid-cut, so it names the offending field and the remedy rather than just failing.
 */
export const configVersionForOrThrow = version => {
  const parsed = parseVersion(version);
  if (!parsed) {
    throw new Error(`${JSON.stringify(version)} is not a valid version; expected X.Y.Z or X.Y.Z-rc.N`);
  }
  const errors = rangeErrors(parsed);
  if (errors.length > 0) throw new Error(`${version} cannot be encoded: ${errors.join('; ')}`);
  return configVersionFor(version);
};

export const decodeConfigVersion = value => {
  if (!Number.isInteger(value) || value < MIN_CONFIG_VERSION || value > MAX_CONFIG_VERSION) return null;
  const slot = value % 100;
  const major = Math.floor(value / 1_000_000);
  const minor = Math.floor(value / 10_000) % 100;
  const patch = Math.floor(value / 100) % 100;
  const rc = slot === RC_STABLE ? null : slot;
  return `${major}.${minor}.${patch}${rc === null ? '' : `-rc.${rc}`}`;
};

export const readManifestVersion = (workspaceRoot = process.cwd()) =>
  JSON.parse(readFileSync(join(workspaceRoot, MANIFEST_PATH), 'utf8')).version;

export const readConfigVersion = (workspaceRoot = process.cwd()) => {
  const match = readFileSync(join(workspaceRoot, CONFIG_PATH), 'utf8').match(CONFIG_VERSION_PATTERN);
  return match ? Number(match[1].replaceAll('_', '')) : null;
};

export const configVersionDriftErrors = (workspaceRoot = process.cwd()) => {
  const version = readManifestVersion(workspaceRoot);
  const actual = readConfigVersion(workspaceRoot);
  if (actual === null) return [`could not read CONFIG_VERSION from ${CONFIG_PATH}`];
  let expected;
  try {
    expected = configVersionForOrThrow(version);
  } catch (error) {
    return [`${MANIFEST_PATH} is ${version}, which cannot be encoded: ${error.message}`];
  }
  if (actual !== expected) {
    return [
      `${CONFIG_PATH} has CONFIG_VERSION ${actual} (${decodeConfigVersion(actual) ?? 'not a config version'}),`,
      `but ${MANIFEST_PATH} is ${version}, which encodes to ${expected}.`,
      'Never hand-edit CONFIG_VERSION — scripts/bump-versions.sh derives it.',
    ];
  }
  return [];
};

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [argument] = process.argv.slice(2);
  try {
    if (argument === '--check') {
      const errors = configVersionDriftErrors(process.cwd());
      if (errors.length > 0) throw new Error(errors.join('\n'));
      console.log(`CONFIG_VERSION matches ${MANIFEST_PATH}. ✓`);
    } else if (argument === undefined) {
      throw new Error('usage: node scripts/config-version.mjs <version> | --check');
    } else {
      console.log(configVersionForOrThrow(argument));
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
