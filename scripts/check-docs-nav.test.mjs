import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { checkDocsNav } from './check-docs-nav.mjs';

const createWorkspace = (t, { navigation, files = [], mintignore } = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'check-docs-nav-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const write = (path, content) => {
    mkdirSync(join(root, dirname(path)), { recursive: true });
    writeFileSync(join(root, path), content);
  };

  write('docs/docs.json', JSON.stringify({ navigation }));
  for (const file of files) write(`docs/${file}`, '');
  if (mintignore !== undefined) write('docs/.mintignore', mintignore);

  return root;
};

test('passes when navigation and files agree', t => {
  const root = createWorkspace(t, {
    navigation: { tabs: [{ tab: 'Home', pages: ['index', { group: 'Swap', pages: ['swap/index'] }] }] },
    files: ['index.mdx', 'swap/index.mdx'],
  });

  const { failures, navPages, files } = checkDocsNav({ root });

  assert.deepEqual(failures, []);
  assert.equal(navPages, 2);
  assert.equal(files, 2);
});

test('flags a nav entry with no file as a sidebar 404', t => {
  const root = createWorkspace(t, {
    navigation: { tabs: [{ tab: 'Home', pages: ['index', 'developers/ai-integration'] }] },
    files: ['index.mdx'],
  });

  const { failures } = checkDocsNav({ root });

  assert.equal(failures.length, 1);
  assert.match(failures[0], /navigates to "developers\/ai-integration"/);
  assert.match(failures[0], /404 in the sidebar/);
});

test('flags a published page that no nav entry reaches', t => {
  const root = createWorkspace(t, {
    navigation: { tabs: [{ tab: 'Home', pages: ['index'] }] },
    files: ['index.mdx', 'orphan.md'],
  });

  const { failures } = checkDocsNav({ root });

  assert.equal(failures.length, 1);
  assert.match(failures[0], /docs\/orphan is published but absent/);
});

test('.mintignore exempts a file from needing a nav entry', t => {
  const root = createWorkspace(t, {
    navigation: { tabs: [{ tab: 'Home', pages: ['index'] }] },
    files: ['index.mdx', 'local-package-testing.md', 'drafts/wip.mdx'],
    mintignore: '# repo docs\nlocal-package-testing.md\ndrafts/\n',
  });

  const { failures, files } = checkDocsNav({ root });

  assert.deepEqual(failures, []);
  assert.equal(files, 1);
});

test('README.md and AGENTS.md are treated the way Mintlify treats them', t => {
  const root = createWorkspace(t, {
    navigation: { tabs: [{ tab: 'Home', pages: ['index'] }] },
    files: ['index.mdx', 'README.md', 'AGENTS.md'],
    // Mintlify skips README.md by default; AGENTS.md only via .mintignore.
    mintignore: 'AGENTS.md\n',
  });

  assert.deepEqual(checkDocsNav({ root }).failures, []);

  const withoutIgnore = createWorkspace(t, {
    navigation: { tabs: [{ tab: 'Home', pages: ['index'] }] },
    files: ['index.mdx', 'README.md', 'AGENTS.md'],
  });

  const { failures } = checkDocsNav({ root: withoutIgnore });
  assert.equal(failures.length, 1);
  assert.match(failures[0], /docs\/AGENTS is published/);
});

test('labels, icons and external links are not treated as page references', t => {
  const root = createWorkspace(t, {
    navigation: {
      tabs: [
        { tab: 'Home', icon: 'house', pages: ['index'] },
        { tab: 'Support', href: 'https://sodax.com/support' },
        {
          tab: 'Reference',
          groups: [{ group: 'HTTP API', icon: 'server', pages: ['api/index', 'https://example.com/spec'] }],
        },
      ],
    },
    files: ['index.mdx', 'api/index.mdx'],
  });

  assert.deepEqual(checkDocsNav({ root }).failures, []);
});

test('reports a missing docs.json instead of throwing', t => {
  const root = mkdtempSync(join(tmpdir(), 'check-docs-nav-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const { failures } = checkDocsNav({ root });

  assert.equal(failures.length, 1);
  assert.match(failures[0], /docs\.json is missing/);
});
