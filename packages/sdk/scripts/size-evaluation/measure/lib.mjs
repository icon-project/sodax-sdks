// Shared bundling + attribution helpers for the SDK size evaluation (see ../README.md).
import { builtinModules, createRequire } from 'node:module';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { gzipSync, brotliCompressSync, constants as zc } from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

export const HERE = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
export const SDK = path.resolve(HERE, '../..');
export const REPO = path.resolve(SDK, '../..');
export const SRC = `${SDK}/src`;
export const ALTERNATIVES = `${HERE}/alternatives`;
export const RESULTS = `${HERE}/results`;

// esbuild is not a direct workspace dependency; use the copy tsup (an SDK devDependency) resolves.
const sdkRequire = createRequire(`${SDK}/package.json`);
export const esbuild = createRequire(sdkRequire.resolve('tsup'))('esbuild');

const NODE_BUILTINS = [...builtinModules, ...builtinModules.map(m => `node:${m}`)];
export const esc = s => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
export const kb = n => (n / 1024).toFixed(1);

export function sizes(buf) {
  return {
    min: buf.length,
    gz: gzipSync(buf, { level: 9 }).length,
    br: brotliCompressSync(buf, {
      params: { [zc.BROTLI_PARAM_QUALITY]: 11, [zc.BROTLI_PARAM_SIZE_HINT]: buf.length },
    }).length,
  };
}

export function saveResult(name, data) {
  mkdirSync(RESULTS, { recursive: true });
  writeFileSync(`${RESULTS}/${name}.json`, `${JSON.stringify(data, null, 2)}\n`);
}

// Attribute an input path to a bucket: npm package name, @sodax/* workspace package, or SDK src area.
export function bucketOf(p) {
  if (p.startsWith('spec-stub:')) return `replaced:${p.split(':').slice(2).join(':')}`;
  const abs = path.isAbsolute(p) ? p : path.join(REPO, p);
  const nm = abs.lastIndexOf('/node_modules/');
  if (nm !== -1) {
    const rest = abs.slice(nm + '/node_modules/'.length).split('/');
    return rest[0].startsWith('@') ? `${rest[0]}/${rest[1]}` : rest[0];
  }
  if (abs.startsWith(`${SRC}/`)) {
    const rel = abs.slice(SRC.length + 1).split('/');
    if (rel[0] === 'shared' && rel.length > 2) {
      if (rel[1] === 'services' && rel[2] === 'spoke') return `sdk:spoke/${rel[3].replace('.ts', '')}`;
      if (rel[1] === 'entities' && rel.length > 3) return `sdk:entities/${rel[2]}`;
      return `sdk:shared/${rel[1]}`;
    }
    return `sdk:${rel[0]}`;
  }
  if (abs.startsWith(`${ALTERNATIVES}/`)) return 'alternative-snippet';
  const ws = abs.match(/\/packages\/([^/]+)\//);
  if (ws) return `@sodax/${ws[1]}`;
  return abs;
}

// Replaces any loaded file whose absolute path matches one of `patterns` with an empty CJS module.
// CJS lets every named import resolve (to undefined) so the rest of the graph still bundles.
function stubPlugin(patterns) {
  return {
    name: 'stub',
    setup(build) {
      if (!patterns.length) return;
      build.onLoad({ filter: /.*/ }, args =>
        patterns.some(re => re.test(args.path)) ? { contents: 'module.exports = {};', loader: 'js' } : undefined,
      );
    },
  };
}

// Stubs a bare import only when it comes from a matching importer (models "SDK code stops importing X"
// while third-party packages that genuinely depend on X keep it). Optional `contents` replaces the module.
function specStubPlugin(specStubs) {
  return {
    name: 'spec-stub',
    setup(build) {
      if (!specStubs.length) return;
      build.onResolve({ filter: /.*/ }, args => {
        const i = specStubs.findIndex(s => s.spec.test(args.path) && s.importer.test(args.importer));
        return i === -1 ? undefined : { path: `${i}:${args.path}`, namespace: 'spec-stub' };
      });
      build.onLoad({ filter: /.*/, namespace: 'spec-stub' }, args => {
        const s = specStubs[Number(args.path.split(':')[0])];
        return { contents: s.contents ?? 'module.exports = {};', loader: 'js' };
      });
    },
  };
}

// Redirects bare specifiers (exact match) to absolute files, e.g. a workspace package's src entry.
function aliasPlugin(aliases) {
  return {
    name: 'alias',
    setup(build) {
      for (const [spec, file] of Object.entries(aliases)) {
        build.onResolve({ filter: new RegExp(`^${esc(spec)}$`) }, () => ({ path: file }));
      }
    },
  };
}

// Browser-targeted, minified ESM bundle of `contents`; node built-ins stay external (polyfills not counted).
export async function bundle({ name, contents, stubs = [], specStubs = [], aliases = {}, resolveDir = SDK }) {
  const result = await esbuild.build({
    stdin: { contents, sourcefile: `${name.replace(/[^\w.-]+/g, '_')}.ts`, loader: 'ts', resolveDir },
    bundle: true,
    resolveExtensions: ['.ts', '.tsx', '.mjs', '.js', '.cjs', '.json'],
    write: false,
    minify: true,
    treeShaking: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    metafile: true,
    logLevel: 'silent',
    absWorkingDir: REPO,
    external: NODE_BUILTINS,
    plugins: [aliasPlugin(aliases), specStubPlugin(specStubs), stubPlugin(stubs)],
    define: { 'process.env.NODE_ENV': '"production"', global: 'globalThis' },
  });
  const meta = Object.values(result.metafile.outputs)[0];
  const byBucket = {};
  for (const [p, { bytesInOutput }] of Object.entries(meta.inputs)) {
    const b = bucketOf(p);
    byBucket[b] = (byBucket[b] ?? 0) + bytesInOutput;
  }
  return {
    name,
    ...sizes(Buffer.from(result.outputFiles[0].contents)),
    byBucket,
    inputs: meta.inputs,
    graph: result.metafile.inputs,
  };
}

export const topBuckets = (byBucket, n) =>
  Object.fromEntries(
    Object.entries(byBucket)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n),
  );

// The two PancakeSwap ABIs the SDK uses, extracted from the installed package so snippets can vendor them.
export async function ensureAbis() {
  const dir = `${ALTERNATIVES}/abi`;
  if (existsSync(`${dir}/CLPositionManagerAbi.json`) && existsSync(`${dir}/CLPoolManagerAbi.json`)) return dir;
  const entry = createRequire(`${SDK}/src/dex/package.json`).resolve('@pancakeswap/infinity-sdk');
  const mod = await import(pathToFileURL(entry.replace(/index\.c?js$/, 'index.mjs')).href);
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/CLPositionManagerAbi.json`, JSON.stringify(mod.CLPositionManagerAbi));
  writeFileSync(`${dir}/CLPoolManagerAbi.json`, JSON.stringify(mod.CLPoolManagerAbi));
  return dir;
}
