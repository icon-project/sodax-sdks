#!/usr/bin/env node
// Use absolute sibling tarball paths because relative file: paths resolve inconsistently after installation.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGES_PATH = 'packages';
const DEFAULT_OUT = 'pack-local-out';
const SCOPE = '@sodax/';
const DEP_FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies'];
const HOW_TO_USE = 'HOW_TO_USE.md';
const SEMVER_SOURCE = String.raw`\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?`;
const SEMVER = new RegExp(`^${SEMVER_SOURCE}$`);

// Match removed or renamed packages without broadening cleanup beyond this script's tarball shape.
const PACKED_TARBALL = new RegExp(String.raw`^sodax-[0-9a-z][0-9a-z-]*-${SEMVER_SOURCE}\.tgz$`);

export const tarballFileName = (name, version) => `${name.replace(/^@/, '').replaceAll('/', '-')}-${version}.tgz`;

// --out may contain unrelated files, so select only artifacts this script produces.
export const packedArtifactNames = fileNames =>
  fileNames.filter(name => name === HOW_TO_USE || PACKED_TARBALL.test(name)).sort();

export const readWorkspacePackages = root => {
  const packagesPath = join(root, PACKAGES_PATH);
  const packages = new Map();

  for (const entry of readdirSync(packagesPath, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const dir = join(packagesPath, entry.name);
    const manifestPath = join(dir, 'package.json');
    let raw;

    try {
      raw = readFileSync(manifestPath, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }

    const manifest = JSON.parse(raw);
    if (typeof manifest.name !== 'string' || manifest.name.length === 0) {
      throw new Error(`${manifestPath} has no package name`);
    }

    packages.set(manifest.name, { name: manifest.name, dir, manifestPath, raw, manifest });
  }

  if (packages.size === 0) throw new Error(`no package manifests found under ${packagesPath}`);
  return packages;
};

const sodaxDependencies = manifest =>
  DEP_FIELDS.flatMap(field => Object.keys(manifest[field] ?? {})).filter(name => name.startsWith(SCOPE));

export const normalizeName = name => (name.startsWith(SCOPE) ? name : `${SCOPE}${name}`);

export const resolveClosure = ({ packages, entries }) => {
  const closure = [];
  const seen = new Set();
  const queue = [];

  for (const entry of entries) {
    const name = normalizeName(entry);
    if (!packages.has(name)) {
      throw new Error(`unknown workspace package "${entry}" (known: ${[...packages.keys()].sort().join(', ')})`);
    }
    if (packages.get(name).manifest.private) throw new Error(`${name} is private and cannot be packed`);
    queue.push(name);
  }

  while (queue.length > 0) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    seen.add(name);

    const pkg = packages.get(name);
    if (!pkg) throw new Error(`${name} is depended on but is not a workspace package`);
    if (pkg.manifest.private) throw new Error(`${name} is private but is required by the requested closure`);

    closure.push(pkg);
    queue.push(...sodaxDependencies(pkg.manifest));
  }

  return closure;
};

export const publishablePackageNames = packages =>
  [...packages.values()].filter(pkg => !pkg.manifest.private).map(pkg => pkg.name);

export const rewriteManifest = ({ manifest, version, tarballPathByName }) => {
  const rewritten = { ...manifest, version };

  for (const field of DEP_FIELDS) {
    const deps = manifest[field];
    if (!deps) continue;

    rewritten[field] = Object.fromEntries(
      Object.entries(deps).map(([name, range]) => {
        const tarballPath = tarballPathByName.get(name);
        if (!name.startsWith(SCOPE) || !tarballPath) return [name, range];
        return [name, `file:${tarballPath}`];
      }),
    );
  }

  return rewritten;
};

const writeManifest = (manifestPath, manifest) => writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

// Restore exact manifest bytes after success, failure, or termination.
const withPatchedManifests = (closure, patch, run) => {
  const patched = [];
  const restore = () => {
    while (patched.length > 0) {
      const pkg = patched.pop();
      try {
        writeFileSync(pkg.manifestPath, pkg.raw);
      } catch (error) {
        console.error(`pack:local: FAILED to restore ${pkg.manifestPath}: ${error.message}`);
      }
    }
  };

  const onSignal = signal => () => {
    restore();
    process.exit(signal === 'SIGINT' ? 130 : 143);
  };
  const handlers = [
    ['SIGINT', onSignal('SIGINT')],
    ['SIGTERM', onSignal('SIGTERM')],
  ];
  for (const [signal, handler] of handlers) process.on(signal, handler);

  try {
    for (const pkg of closure) {
      writeManifest(pkg.manifestPath, patch(pkg));
      patched.push(pkg);
    }
    return run();
  } finally {
    restore();
    for (const [signal, handler] of handlers) process.off(signal, handler);
  }
};

const pnpmCommand = () => (process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm');

const runPnpm = (args, { cwd, capture = false }) => {
  const result = spawnSync(pnpmCommand(), args, {
    cwd,
    env: process.env,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  });

  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`pnpm ${args.join(' ')} failed with exit code ${result.status}`);
  return result.stdout ?? '';
};

const buildClosure = ({ root, closure }) => {
  const buildable = closure.filter(pkg => pkg.manifest.scripts?.build);
  if (buildable.length === 0) return;

  console.log(`pack:local: building ${buildable.map(pkg => pkg.name).join(', ')}`);
  runPnpm(['exec', 'turbo', 'run', 'build', ...buildable.map(pkg => `--filter=${pkg.name}`)], { cwd: root });
};

// Remove only generated artifacts; stale tarballs can satisfy absolute file: dependencies.
const cleanOutDir = outDir => {
  if (!existsSync(outDir)) return [];

  const removable = packedArtifactNames(readdirSync(outDir));
  for (const name of removable) rmSync(join(outDir, name), { force: true });
  return removable;
};

export const renderDependencyLines = ({ packages, version, outDir }) =>
  packages.map(pkg => `    "${pkg.name}": "file:${join(outDir, tarballFileName(pkg.name, version))}"`).join(',\n');

const renderHowToUse = ({ version, entryPackages, closure, outDir }) => {
  const dependencyBlock = packages => renderDependencyLines({ packages, version, outDir });

  return `# Local @sodax tarballs — ${version}

Built from a local \`sodax-sdks\` working tree by \`pnpm pack:local\`. The intra-\`@sodax\`
dependencies inside these tarballs point at each other by absolute \`file:\` path, so installing an
entry package pulls the rest of the closure from this directory with no registry lookups.

## Install

Add the entry package to the consuming project's \`package.json\`:

\`\`\`json
{
  "dependencies": {
${dependencyBlock(entryPackages)}
  }
}
\`\`\`

Then install:

\`\`\`bash
npm install     # or: pnpm install / yarn install
\`\`\`

If you also import from the transitive packages directly, add them too:

\`\`\`json
{
  "dependencies": {
${dependencyBlock(closure)}
  }
}
\`\`\`

## Re-packing

Every \`pnpm pack:local\` run clears this directory first, so the tarballs listed below are the only
ones here — a \`file:\` path from an earlier run will no longer resolve. Pass \`--no-clean\` to keep
the older tarballs alongside the new ones.

Package managers also cache tarballs by path, so re-packing the **same** version to the **same** path
leaves the consumer on the stale copy. Either pack a fresh version each time
(\`pnpm pack:local --version ${version} --stamp\`), or in the consuming project run:

\`\`\`bash
rm -rf node_modules && rm -f package-lock.json pnpm-lock.yaml yarn.lock && npm install
\`\`\`

## Contents

${closure.map(pkg => `- \`${tarballFileName(pkg.name, version)}\` — ${pkg.name}`).join('\n')}
`;
};

const USAGE = `Usage: pnpm pack:local --version <version> [options]

  --version <version>   Version stamped onto every packed package (required).
  --stamp               Append a UTC timestamp to --version, so each run is a distinct version.
  --packages <names>    Comma-separated entry packages; @sodax/ prefix optional.
                        Their @sodax dependencies are included automatically.
                        Default: every publishable workspace package.
  --out <dir>           Output directory (default: ${DEFAULT_OUT}).
  --no-build            Skip the turbo build and pack whatever is in dist/.
  --no-clean            Keep tarballs from previous runs instead of clearing the output directory.
  --dry-run             Print the plan without building, rewriting, or packing.
  --help                Show this message.`;

export const parseArgs = argv => {
  const options = {
    version: null,
    stamp: false,
    entries: null,
    out: DEFAULT_OUT,
    build: true,
    clean: true,
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith('--')) throw new Error(`${arg} requires a value`);
      index += 1;
      return next;
    };

    if (arg === '--help' || arg === '-h') return { ...options, help: true };
    else if (arg === '--version') options.version = value();
    else if (arg === '--stamp') options.stamp = true;
    else if (arg === '--packages')
      options.entries = value()
        .split(',')
        .map(name => name.trim())
        .filter(Boolean);
    else if (arg === '--out') options.out = value();
    else if (arg === '--no-build') options.build = false;
    else if (arg === '--no-clean') options.clean = false;
    else if (arg === '--dry-run') options.dryRun = true;
    else throw new Error(`unknown argument "${arg}"\n\n${USAGE}`);
  }

  if (!options.version) throw new Error(`--version is required\n\n${USAGE}`);

  if (options.stamp) {
    const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
    options.version = `${options.version}.${stamp}`;
  }

  if (!SEMVER.test(options.version)) throw new Error(`"${options.version}" is not a valid semver version`);

  return options;
};

export const packLocal = ({ root, version, entries, out, build, clean = true, dryRun }) => {
  const packages = readWorkspacePackages(root);
  const requested = entries ?? publishablePackageNames(packages);
  const closure = resolveClosure({ packages, entries: requested });
  const entryNames = new Set(requested.map(normalizeName));
  const entryPackages = closure.filter(pkg => entryNames.has(pkg.name));
  const outDir = resolve(root, out);
  const tarballPathByName = new Map(closure.map(pkg => [pkg.name, join(outDir, tarballFileName(pkg.name, version))]));

  console.log(`pack:local: version ${version}`);
  console.log(`pack:local: packing ${closure.length} package(s): ${closure.map(pkg => pkg.name).join(', ')}`);
  console.log(`pack:local: output  ${outDir}`);

  const existing = clean && existsSync(outDir) ? packedArtifactNames(readdirSync(outDir)) : [];
  if (existing.length > 0) {
    console.log(
      `pack:local: ${dryRun ? 'would remove' : 'removing'} ${existing.length} artifact(s) from a previous run: ` +
        existing.join(', '),
    );
  }

  if (dryRun) {
    console.log('pack:local: --dry-run, nothing written');
    return { version, outDir, closure, entryPackages, tarballs: [], removed: [] };
  }

  mkdirSync(outDir, { recursive: true });

  const repacked = [...tarballPathByName.values()].filter(path => existsSync(path));
  if (repacked.length > 0) {
    console.warn(
      `pack:local: re-packing ${repacked.length} tarball(s) at the same version (${version}) — consumers that` +
        ' already installed it must clear node_modules and their lockfile, or use --stamp',
    );
  }

  if (build) buildClosure({ root, closure });

  // Clean only after a successful build so existing tarballs survive build failures.
  const removed = clean ? cleanOutDir(outDir) : [];

  const tarballs = withPatchedManifests(
    closure,
    pkg => rewriteManifest({ manifest: pkg.manifest, version, tarballPathByName }),
    () =>
      closure.map(pkg => {
        runPnpm(['pack', '--pack-destination', outDir], { cwd: pkg.dir, capture: true });

        const tarballPath = tarballPathByName.get(pkg.name);
        if (!existsSync(tarballPath)) throw new Error(`pnpm pack did not produce ${tarballPath}`);

        console.log(`pack:local: packed ${pkg.name} -> ${tarballPath}`);
        return tarballPath;
      }),
  );

  writeFileSync(join(outDir, HOW_TO_USE), renderHowToUse({ version, entryPackages, closure, outDir }));

  return { version, outDir, closure, entryPackages, tarballs, removed };
};

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  try {
    const options = parseArgs(process.argv.slice(2));

    if (options.help) {
      console.log(USAGE);
      process.exit(0);
    }

    const { version, outDir, closure, entryPackages, tarballs } = packLocal({ root: process.cwd(), ...options });

    if (tarballs.length > 0) {
      console.log(`\npack:local: done — ${tarballs.length} tarball(s) in ${outDir}`);

      console.log('\nPaste into the consuming project\'s package.json "dependencies":\n');
      console.log(renderDependencyLines({ packages: entryPackages, version, outDir }));

      if (entryPackages.length < closure.length) {
        console.log('\nThe rest of the closure comes along automatically. Paste this block instead if you');
        console.log('import from those packages directly:\n');
        console.log(renderDependencyLines({ packages: closure, version, outDir }));
      }

      console.log(`\npack:local: re-pack notes in ${join(outDir, HOW_TO_USE)}`);
    }
  } catch (error) {
    console.error(`pack:local: ${error.message}`);
    process.exit(1);
  }
}
