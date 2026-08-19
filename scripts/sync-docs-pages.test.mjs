import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { syncDocsPages } from './sync-docs-pages.mjs';

const createWorkspace = (t, { mirrored, files = {} }) => {
  const root = mkdtempSync(join(tmpdir(), 'sync-docs-pages-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const write = (path, content) => {
    mkdirSync(join(root, dirname(path)), { recursive: true });
    writeFileSync(join(root, path), content);
  };

  write('scripts/gitbook-sync-map.json', JSON.stringify({ mirrored }));
  for (const [path, content] of Object.entries(files)) write(path, content);

  return { root, read: path => readFileSync(join(root, path), 'utf8') };
};

const ENTRY = { src: 'packages/sdk/docs/SWAPS.md', dest: 'developers/swaps.md', icon: 'rotate' };

test('generates a page with frontmatter and drops the duplicated source H1', t => {
  const { root, read } = createWorkspace(t, {
    mirrored: [ENTRY],
    files: { 'packages/sdk/docs/SWAPS.md': '# Swaps (Solver)\n\nBody text.\n' },
  });

  const { written } = syncDocsPages({ root });

  assert.deepEqual(written, ['docs/developers/swaps.md']);
  const page = read('docs/developers/swaps.md');
  assert.match(page, /^---\ntitle: "Swaps \(Solver\)"\nicon: rotate\n# Generated from packages\/sdk\/docs\/SWAPS\.md/);
  assert.match(page, /\nBody text\.\n$/);
  assert.doesNotMatch(page, /# Swaps \(Solver\)/);
});

test('a map title overrides the source heading', t => {
  const { root, read } = createWorkspace(t, {
    mirrored: [{ ...ENTRY, title: 'Swaps' }],
    files: { 'packages/sdk/docs/SWAPS.md': '# Swaps (Solver)\n\nBody.\n' },
  });

  syncDocsPages({ root });

  assert.match(read('docs/developers/swaps.md'), /title: "Swaps"/);
});

test('relative links between sources become root-relative page paths', t => {
  const { root, read } = createWorkspace(t, {
    mirrored: [ENTRY, { src: 'packages/sdk/docs/CONFIGURE_SDK.md', dest: 'developers/configure.md', icon: 'gears' }],
    files: {
      'packages/sdk/docs/SWAPS.md': '# Swaps\n\nSee [config](./CONFIGURE_SDK.md#hub) first.\n',
      'packages/sdk/docs/CONFIGURE_SDK.md': '# Configure\n\nBody.\n',
    },
  });

  syncDocsPages({ root });

  assert.match(read('docs/developers/swaps.md'), /\[config\]\(\/developers\/configure#hub\)/);
});

test('--check reports drift instead of writing', t => {
  const { root } = createWorkspace(t, {
    mirrored: [ENTRY],
    files: {
      'packages/sdk/docs/SWAPS.md': '# Swaps\n\nNew body.\n',
      'docs/developers/swaps.md': '---\ntitle: "Swaps"\n---\n\nStale body.\n',
    },
  });

  const { stale, written } = syncDocsPages({ root, check: true });

  assert.deepEqual(written, []);
  assert.equal(stale.length, 1);
  assert.match(stale[0], /docs\/developers\/swaps\.md differs from packages\/sdk\/docs\/SWAPS\.md/);
});

test('--check reports a page that was never generated', t => {
  const { root } = createWorkspace(t, {
    mirrored: [ENTRY],
    files: { 'packages/sdk/docs/SWAPS.md': '# Swaps\n\nBody.\n' },
  });

  assert.match(syncDocsPages({ root, check: true }).stale[0], /is missing/);
});

test('a source with no H1 and no map title is an error, not an untitled page', t => {
  const { root } = createWorkspace(t, {
    mirrored: [ENTRY],
    files: { 'packages/sdk/docs/SWAPS.md': 'Body with no heading.\n' },
  });

  assert.throws(() => syncDocsPages({ root }), /has no H1/);
});

test('a map entry without an icon is an error', t => {
  const { root } = createWorkspace(t, {
    mirrored: [{ src: ENTRY.src, dest: ENTRY.dest }],
    files: { 'packages/sdk/docs/SWAPS.md': '# Swaps\n\nBody.\n' },
  });

  assert.throws(() => syncDocsPages({ root }), /has no "icon"/);
});

test('pages already under docs/ are left alone', t => {
  const { root } = createWorkspace(t, {
    mirrored: [{ src: 'docs/ai-integration-guide.md', dest: 'developers/ai-integration.md', icon: 'robot' }],
    files: { 'docs/ai-integration-guide.md': '# Guide\n\nBody.\n' },
  });

  assert.deepEqual(syncDocsPages({ root }), { entries: 0, written: [], stale: [] });
});
