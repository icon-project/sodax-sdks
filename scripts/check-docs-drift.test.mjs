import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../.github/scripts/check-docs-drift.sh', import.meta.url));

const MAP = {
  mirrored: [
    { src: 'packages/sdk/docs/SWAPS.md', dest: 'developers/swaps.md' },
    { src: 'packages/sdk/README.md', dest: 'developers/sdk.md' },
    { src: 'packages/skills/README.md', dest: 'developers/skills.md' },
  ],
};

const write = (root, path, content) => {
  mkdirSync(join(root, dirname(path)), { recursive: true });
  writeFileSync(join(root, path), content);
};

const git = (root, args, opts = {}) =>
  execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', HUSKY: '0' },
    ...opts,
  }).trim();

const commit = (root, message) => {
  git(root, ['add', '-A']);
  git(root, ['-c', 'user.email=test@example.com', '-c', 'user.name=test', 'commit', '-m', message]);
  return git(root, ['rev-parse', 'HEAD']);
};

const createRepo = t => {
  const root = mkdtempSync(join(fileURLToPath(new URL('..', import.meta.url)), '.tmp-docs-drift-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const template = join(root, '.git-template');
  mkdirSync(join(template, 'hooks'), { recursive: true });
  git(root, ['init', '-b', 'main', `--template=${template}`]);
  write(root, 'scripts/gitbook-sync-map.json', `${JSON.stringify(MAP, null, 2)}\n`);
  write(root, 'packages/sdk/src/index.ts', 'export const n = 1;\n');
  write(root, 'packages/sdk/docs/SWAPS.md', '# Swaps\n');
  write(root, 'packages/sdk/README.md', '# sdk\n');
  write(root, 'packages/skills/README.md', '# skills\n');
  write(root, 'packages/types/src/index.ts', 'export type T = string;\n');
  write(root, 'packages/types/README.md', '# types\n');
  const base = commit(root, 'base');
  return { root, base };
};

const run = (root, base, head) => {
  try {
    const out = execFileSync('bash', [SCRIPT, base, head], { cwd: root, encoding: 'utf8' });
    return { code: 0, out };
  } catch (error) {
    return {
      code: error.status ?? 1,
      out: `${error.stdout ?? ''}${error.stderr ?? ''}`,
    };
  }
};

test('passes when no package src changed', t => {
  const { root, base } = createRepo(t);
  write(root, 'CONTRIBUTING.md', '# contrib\n');
  const head = commit(root, 'docs process');

  const result = run(root, base, head);
  assert.equal(result.code, 0);
  assert.match(result.out, /docs check not applicable/);
});

test('fails when sdk src changes with no docs', t => {
  const { root, base } = createRepo(t);
  write(root, 'packages/sdk/src/index.ts', 'export const n = 2;\n');
  const head = commit(root, 'sdk src only');

  const result = run(root, base, head);
  assert.equal(result.code, 1);
  assert.match(result.out, /Source changed in: sdk/);
});

test('passes when sdk src changes with a mapped feature page', t => {
  const { root, base } = createRepo(t);
  write(root, 'packages/sdk/src/index.ts', 'export const n = 2;\n');
  write(root, 'packages/sdk/docs/SWAPS.md', '# Swaps\n\nUpdated.\n');
  const head = commit(root, 'sdk + swaps.md');

  const result = run(root, base, head);
  assert.equal(result.code, 0);
  assert.match(result.out, /docs signal/);
});

test('fails when sdk src changes with an unrelated mapped README', t => {
  const { root, base } = createRepo(t);
  write(root, 'packages/sdk/src/index.ts', 'export const n = 2;\n');
  write(root, 'packages/skills/README.md', '# skills\n\nUnrelated.\n');
  const head = commit(root, 'sdk + skills readme');

  const result = run(root, base, head);
  assert.equal(result.code, 1);
  assert.match(result.out, /Source changed in: sdk/);
  assert.match(result.out, /unrelated mapped file/);
});

test('passes when types src changes with a mapped sdk feature page', t => {
  const { root, base } = createRepo(t);
  write(root, 'packages/types/src/index.ts', 'export type T = number;\n');
  write(root, 'packages/sdk/docs/SWAPS.md', '# Swaps\n\nToken list.\n');
  const head = commit(root, 'types + swaps.md');

  const result = run(root, base, head);
  assert.equal(result.code, 0);
  assert.match(result.out, /docs signal/);
});

test('fails when a new sdk doc is not on the map', t => {
  const { root, base } = createRepo(t);
  write(root, 'packages/sdk/src/index.ts', 'export const n = 2;\n');
  write(root, 'packages/sdk/docs/SWAPS.md', '# Swaps\n\nUpdated.\n');
  write(root, 'packages/sdk/docs/NEW.md', '# New\n');
  const head = commit(root, 'unmapped new page');

  const result = run(root, base, head);
  assert.equal(result.code, 1);
  assert.match(result.out, /not in scripts\/gitbook-sync-map.json/);
  assert.match(result.out, /packages\/sdk\/docs\/NEW.md/);
});

test('ignores test-only src changes', t => {
  const { root, base } = createRepo(t);
  write(root, 'packages/sdk/src/index.test.ts', 'test("n", () => {});\n');
  const head = commit(root, 'test only');

  const result = run(root, base, head);
  assert.equal(result.code, 0);
  assert.match(result.out, /docs check not applicable/);
});
