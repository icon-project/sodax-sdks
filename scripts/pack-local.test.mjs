import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  normalizeName,
  packedArtifactNames,
  packLocal,
  parseArgs,
  publishablePackageNames,
  readWorkspacePackages,
  renderDependencyLines,
  resolveClosure,
  rewriteManifest,
  tarballFileName,
} from './pack-local.mjs';

const WORKSPACE = {
  types: { name: '@sodax/types', version: '2.0.0-rc.17' },
  'swaps-api': {
    name: '@sodax/swaps-api',
    version: '2.0.0-rc.17',
    dependencies: { '@sodax/types': 'workspace:*', valibot: 'catalog:' },
  },
  sdk: {
    name: '@sodax/sdk',
    version: '2.0.0-rc.17',
    dependencies: { '@sodax/swaps-api': 'workspace:*', viem: 'catalog:' },
    scripts: { build: 'tsup' },
  },
  'dapp-kit': {
    name: '@sodax/dapp-kit',
    version: '2.0.0-rc.17',
    dependencies: { '@sodax/sdk': 'workspace:*' },
    peerDependencies: { '@sodax/types': 'workspace:*', react: '^19' },
  },
  assets: { name: '@sodax/assets', version: '0.0.1', private: true },
};

const createWorkspace = (t, packages = WORKSPACE) => {
  const root = mkdtempSync(join(tmpdir(), 'pack-local-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  for (const [dir, manifest] of Object.entries(packages)) {
    mkdirSync(join(root, 'packages', dir), { recursive: true });
    writeFileSync(join(root, 'packages', dir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  }

  return root;
};

const closureNames = (root, entries) =>
  resolveClosure({ packages: readWorkspacePackages(root), entries }).map(pkg => pkg.name);

test('tarballFileName matches the name pnpm pack writes for a scoped package', () => {
  assert.equal(tarballFileName('@sodax/swaps-api', '2.0.0-rc.17'), 'sodax-swaps-api-2.0.0-rc.17.tgz');
});

test('resolveClosure pulls in transitive @sodax dependencies', t => {
  const root = createWorkspace(t);

  assert.deepEqual(closureNames(root, ['@sodax/sdk']), ['@sodax/sdk', '@sodax/swaps-api', '@sodax/types']);
});

test('resolveClosure follows peerDependencies as well as dependencies', t => {
  const root = createWorkspace(t);

  assert.deepEqual(closureNames(root, ['@sodax/dapp-kit']).sort(), [
    '@sodax/dapp-kit',
    '@sodax/sdk',
    '@sodax/swaps-api',
    '@sodax/types',
  ]);
});

test('resolveClosure accepts unscoped entry names', t => {
  const root = createWorkspace(t);

  assert.deepEqual(closureNames(root, ['types']), ['@sodax/types']);
});

test('resolveClosure rejects an unknown package', t => {
  const root = createWorkspace(t);

  assert.throws(() => closureNames(root, ['@sodax/nope']), /unknown workspace package "@sodax\/nope"/);
});

test('resolveClosure rejects a private package', t => {
  const root = createWorkspace(t);

  assert.throws(() => closureNames(root, ['@sodax/assets']), /@sodax\/assets is private/);
});

test('publishablePackageNames skips private packages', t => {
  const root = createWorkspace(t);

  assert.equal(publishablePackageNames(readWorkspacePackages(root)).includes('@sodax/assets'), false);
});

test('rewriteManifest points @sodax deps at sibling tarballs and leaves the rest alone', () => {
  const tarballPathByName = new Map([
    ['@sodax/types', '/out/sodax-types-9.9.9.tgz'],
    ['@sodax/sdk', '/out/sodax-sdk-9.9.9.tgz'],
  ]);

  const rewritten = rewriteManifest({
    manifest: WORKSPACE['dapp-kit'],
    version: '9.9.9',
    tarballPathByName,
  });

  assert.equal(rewritten.version, '9.9.9');
  assert.deepEqual(rewritten.dependencies, { '@sodax/sdk': 'file:/out/sodax-sdk-9.9.9.tgz' });
  assert.deepEqual(rewritten.peerDependencies, {
    '@sodax/types': 'file:/out/sodax-types-9.9.9.tgz',
    react: '^19',
  });
});

test('rewriteManifest leaves an @sodax dep outside the closure untouched', () => {
  const rewritten = rewriteManifest({
    manifest: WORKSPACE['dapp-kit'],
    version: '9.9.9',
    tarballPathByName: new Map(),
  });

  assert.equal(rewritten.dependencies['@sodax/sdk'], 'workspace:*');
});

test('rewriteManifest does not mutate the source manifest', () => {
  const manifest = structuredClone(WORKSPACE.sdk);

  rewriteManifest({
    manifest,
    version: '9.9.9',
    tarballPathByName: new Map([['@sodax/swaps-api', '/out/sodax-swaps-api-9.9.9.tgz']]),
  });

  assert.deepEqual(manifest, WORKSPACE.sdk);
});

test('normalizeName adds the scope only when it is missing', () => {
  assert.equal(normalizeName('sdk'), '@sodax/sdk');
  assert.equal(normalizeName('@sodax/sdk'), '@sodax/sdk');
});

test('renderDependencyLines emits a block that parses as package.json dependencies', () => {
  const packages = [{ name: '@sodax/sdk' }, { name: '@sodax/types' }];

  const block = renderDependencyLines({ packages, version: '9.9.9', outDir: '/out' });

  assert.deepEqual(JSON.parse(`{${block}}`), {
    '@sodax/sdk': 'file:/out/sodax-sdk-9.9.9.tgz',
    '@sodax/types': 'file:/out/sodax-types-9.9.9.tgz',
  });
});

test('renderDependencyLines indents to sit inside a "dependencies" object', () => {
  const block = renderDependencyLines({ packages: [{ name: '@sodax/sdk' }], version: '9.9.9', outDir: '/out' });

  assert.equal(block, '    "@sodax/sdk": "file:/out/sodax-sdk-9.9.9.tgz"');
});

test("packedArtifactNames matches this script's own tarballs and its HOW_TO_USE", () => {
  assert.deepEqual(
    packedArtifactNames([
      'sodax-sdk-2.0.0-local.1.tgz',
      'sodax-swaps-api-2.0.0-local.1.20260801093000.tgz',
      'sodax-types-1.2.3.tgz',
      'HOW_TO_USE.md',
    ]),
    [
      'HOW_TO_USE.md',
      'sodax-sdk-2.0.0-local.1.tgz',
      'sodax-swaps-api-2.0.0-local.1.20260801093000.tgz',
      'sodax-types-1.2.3.tgz',
    ],
  );
});

test('packedArtifactNames leaves anything this script did not write alone', () => {
  assert.deepEqual(
    packedArtifactNames([
      'notes.md',
      'package.json',
      'other-sdk-1.0.0.tgz',
      'sodax-sdk.tgz',
      'sodax-sdk-not-a-version.tgz',
      'sodax-sdk-2.0.0.tgz.bak',
      'nested',
    ]),
    [],
  );
});

test('packLocal clears artifacts from a previous run before packing', t => {
  const root = createWorkspace(t);
  const outDir = join(root, 'out');
  mkdirSync(outDir, { recursive: true });

  writeFileSync(join(outDir, 'sodax-sdk-1.0.0-local.9.tgz'), 'stale');
  writeFileSync(join(outDir, 'HOW_TO_USE.md'), 'stale');
  writeFileSync(join(outDir, 'keep-me.txt'), 'mine');

  assert.throws(() => packLocal({ root, version: '9.9.9', entries: ['@sodax/sdk'], out: 'out', build: false }));

  assert.equal(existsSync(join(outDir, 'sodax-sdk-1.0.0-local.9.tgz')), false);
  assert.equal(existsSync(join(outDir, 'HOW_TO_USE.md')), false);
  assert.equal(existsSync(join(outDir, 'keep-me.txt')), true);
});

test('packLocal keeps previous artifacts when the BUILD fails', t => {
  const root = createWorkspace(t);
  const outDir = join(root, 'out');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'sodax-sdk-1.0.0-local.9.tgz'), 'stale');

  assert.throws(() => packLocal({ root, version: '9.9.9', entries: ['@sodax/sdk'], out: 'out', build: true }));

  assert.equal(existsSync(join(outDir, 'sodax-sdk-1.0.0-local.9.tgz')), true);
});

test('packLocal --no-clean keeps artifacts from a previous run', t => {
  const root = createWorkspace(t);
  const outDir = join(root, 'out');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'sodax-sdk-1.0.0-local.9.tgz'), 'stale');

  assert.throws(() =>
    packLocal({ root, version: '9.9.9', entries: ['@sodax/sdk'], out: 'out', build: false, clean: false }),
  );

  assert.equal(existsSync(join(outDir, 'sodax-sdk-1.0.0-local.9.tgz')), true);
});

test('packLocal --dry-run leaves previous artifacts in place', t => {
  const root = createWorkspace(t);
  const outDir = join(root, 'out');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'sodax-sdk-1.0.0-local.9.tgz'), 'stale');

  const result = packLocal({ root, version: '9.9.9', entries: ['@sodax/sdk'], out: 'out', build: false, dryRun: true });

  assert.deepEqual(result.removed, []);
  assert.equal(existsSync(join(outDir, 'sodax-sdk-1.0.0-local.9.tgz')), true);
});

test('packLocal reports the entry packages separately from the closure', t => {
  const root = createWorkspace(t);

  const result = packLocal({ root, version: '9.9.9', entries: ['sdk'], out: 'out', build: false, dryRun: true });

  assert.deepEqual(
    result.entryPackages.map(pkg => pkg.name),
    ['@sodax/sdk'],
  );
  assert.deepEqual(
    result.closure.map(pkg => pkg.name),
    ['@sodax/sdk', '@sodax/swaps-api', '@sodax/types'],
  );
});

test('packLocal restores every manifest when packing throws', t => {
  const root = createWorkspace(t);
  const before = Object.keys(WORKSPACE).map(dir => readFileSync(join(root, 'packages', dir, 'package.json'), 'utf8'));

  assert.throws(() => packLocal({ root, version: '9.9.9', entries: ['@sodax/sdk'], out: 'out', build: false }));

  const after = Object.keys(WORKSPACE).map(dir => readFileSync(join(root, 'packages', dir, 'package.json'), 'utf8'));
  assert.deepEqual(after, before);
});

test('packLocal --dry-run reports the closure without touching manifests', t => {
  const root = createWorkspace(t);
  const before = readFileSync(join(root, 'packages', 'sdk', 'package.json'), 'utf8');

  const result = packLocal({ root, version: '9.9.9', entries: ['@sodax/sdk'], out: 'out', build: true, dryRun: true });

  assert.deepEqual(
    result.closure.map(pkg => pkg.name),
    ['@sodax/sdk', '@sodax/swaps-api', '@sodax/types'],
  );
  assert.deepEqual(result.tarballs, []);
  assert.equal(readFileSync(join(root, 'packages', 'sdk', 'package.json'), 'utf8'), before);
});

test('parseArgs requires a version', () => {
  assert.throws(() => parseArgs([]), /--version is required/);
});

test('parseArgs rejects a non-semver version', () => {
  assert.throws(() => parseArgs(['--version', 'local']), /not a valid semver version/);
});

test('parseArgs rejects an unknown flag', () => {
  assert.throws(() => parseArgs(['--version', '1.0.0', '--nope']), /unknown argument "--nope"/);
});

test('parseArgs rejects a flag used as a value', () => {
  assert.throws(() => parseArgs(['--version', '--out']), /--version requires a value/);
});

test('parseArgs reads packages, out and --no-build', () => {
  const options = parseArgs([
    '--version',
    '2.0.0-local.1',
    '--packages',
    '@sodax/sdk, dapp-kit',
    '--out',
    '../sodax-packs',
    '--no-build',
  ]);

  assert.deepEqual(options, {
    version: '2.0.0-local.1',
    stamp: false,
    entries: ['@sodax/sdk', 'dapp-kit'],
    out: '../sodax-packs',
    build: false,
    clean: true,
    dryRun: false,
  });
});

test('parseArgs cleans the output directory unless --no-clean is passed', () => {
  assert.equal(parseArgs(['--version', '1.0.0']).clean, true);
  assert.equal(parseArgs(['--version', '1.0.0', '--no-clean']).clean, false);
});

test('parseArgs --stamp appends a sortable timestamp that keeps the version valid semver', () => {
  const { version } = parseArgs(['--version', '2.0.0-local.1', '--stamp']);

  assert.match(version, /^2\.0\.0-local\.1\.\d{14}$/);
});

test('parseArgs --help short-circuits before the version check', () => {
  assert.equal(parseArgs(['--help']).help, true);
});
