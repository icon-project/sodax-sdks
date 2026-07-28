import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { checkDocLinks } from './check-doc-links.mjs';

// The two shapes that matter: a doc the mirror keeps in place, and one it moves elsewhere.
const MIRRORED = [
  { src: 'packages/sdk/docs/CONFIGURE_SDK.md', dest: 'developers/packages/sdk/docs/CONFIGURE_SDK.md' },
  { src: 'packages/sdk/docs/HOW_TO_MAKE_A_SWAP.md', dest: 'developers/packages/sdk/docs/HOW_TO_MAKE_A_SWAP.md' },
  { src: 'packages/sdk/docs/SWAPS.md', dest: 'developers/packages/foundation/sdk/functional-modules/swaps.md' },
];

const createWorkspace = (t, { mirrored = MIRRORED, files = {} } = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'check-doc-links-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const write = (path, content) => {
    mkdirSync(join(root, dirname(path)), { recursive: true });
    writeFileSync(join(root, path), content);
  };

  write('scripts/gitbook-sync-map.json', JSON.stringify({ mirrored }));
  for (const { src } of mirrored) write(src, '');
  write('packages/sdk/docs/LOGGING.md', '');
  write('packages/sdk/src/index.ts', '');
  for (const [path, content] of Object.entries(files)) write(path, content);

  return root;
};

const run = (t, files, mirrored) => checkDocLinks({ root: createWorkspace(t, { files, mirrored }) }).failures;

test('accepts a relative link when the mirror keeps both docs in the same directory', t => {
  const failures = run(t, {
    'packages/sdk/docs/HOW_TO_MAKE_A_SWAP.md': 'See [CONFIGURE_SDK.md](./CONFIGURE_SDK.md) for config.\n',
  });

  assert.deepEqual(failures, []);
});

test('rejects a relative link to a doc the mirror moves elsewhere', t => {
  const failures = run(t, {
    'packages/sdk/docs/HOW_TO_MAKE_A_SWAP.md': 'See [SWAPS.md](./SWAPS.md#error-handling).\n',
  });

  assert.equal(failures.length, 1);
  assert.match(failures[0], /^packages\/sdk\/docs\/HOW_TO_MAKE_A_SWAP\.md:1 /);
  assert.match(failures[0], /moves it to developers\/packages\/foundation\/sdk\/functional-modules\/swaps\.md/);
  assert.match(
    failures[0],
    /https:\/\/github\.com\/icon-project\/sodax-sdks\/blob\/main\/packages\/sdk\/docs\/SWAPS\.md#error-handling/,
  );
});

test('rejects a relative link to a file that is not mirrored at all', t => {
  const failures = run(t, {
    'packages/sdk/docs/CONFIGURE_SDK.md': 'The logger sink (see [LOGGING.md](./LOGGING.md)).\n',
  });

  assert.equal(failures.length, 1);
  assert.match(failures[0], /not mirrored into GitBook/);
  assert.match(failures[0], /blob\/main\/packages\/sdk\/docs\/LOGGING\.md/);
});

test('suggests a tree URL for a directory target', t => {
  const failures = run(t, {
    'packages/sdk/docs/CONFIGURE_SDK.md': 'See [`src/`](../src/) for sources.\n',
  });

  assert.equal(failures.length, 1);
  assert.match(failures[0], /tree\/main\/packages\/sdk\/src/);
});

test('rejects links into the sodax-document and sodax-frontend repos', t => {
  const failures = run(t, {
    'packages/sdk/docs/CONFIGURE_SDK.md': [
      '[Contributing](https://github.com/icon-project/sodax-document/blob/main/developers/packages/sdk/CONTRIBUTING.md)',
      '[Old repo](https://github.com/icon-project/sodax-frontend/blob/main/packages/sdk/README.md)',
    ].join('\n'),
  });

  assert.equal(failures.length, 2);
  assert.match(failures[0], /links into github\.com\/icon-project\/sodax-document\//);
  assert.match(failures[1], /the repo was renamed to sodax-sdks/);
});

test('rejects an absolute source URL whose path no longer exists', t => {
  const failures = run(t, {
    'packages/sdk/docs/CONFIGURE_SDK.md': [
      '[gone](https://github.com/icon-project/sodax-sdks/blob/main/packages/types/src/constants/index.ts)',
      '[here](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/src/index.ts)',
    ].join('\n'),
  });

  assert.equal(failures.length, 1);
  assert.match(failures[0], /packages\/types\/src\/constants\/index\.ts, which does not exist in this repo/);
});

test('ignores anchors, code fences and inline code', t => {
  const failures = run(t, {
    'packages/sdk/docs/CONFIGURE_SDK.md': [
      'Jump to [the section](#backend-submit-tx-2-step).',
      'Inline example: `[SWAPS.md](./SWAPS.md)` stays prose.',
      '```md',
      '[SWAPS.md](./SWAPS.md)',
      '```',
    ].join('\n'),
  });

  assert.deepEqual(failures, []);
});

test('flags a manifest entry whose source file is gone', t => {
  const mirrored = [...MIRRORED, { src: 'packages/sdk/docs/RENAMED.md', dest: 'developers/renamed.md' }];
  const root = createWorkspace(t, { mirrored });
  rmSync(join(root, 'packages/sdk/docs/RENAMED.md'));

  const failures = checkDocLinks({ root }).failures;

  assert.equal(failures.length, 1);
  assert.match(failures[0], /maps missing file packages\/sdk\/docs\/RENAMED\.md/);
});

test('reports a missing manifest instead of silently passing', t => {
  const root = createWorkspace(t);

  const failures = checkDocLinks({ root, manifestPath: 'scripts/missing.json' }).failures;

  assert.deepEqual(failures, ['Missing GitBook mirror manifest scripts/missing.json']);
});
