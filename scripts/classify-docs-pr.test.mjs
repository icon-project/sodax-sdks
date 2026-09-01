import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../.github/scripts/classify-docs-pr.sh', import.meta.url));

const page = (title, extra = '') => `---\ntitle: "${title}"\nicon: book\n${extra}---\n\n## ${title}\n`;
const generated = (title, src) => page(title, `generatedFrom: ${src}\n`);

const write = (root, path, content) => {
  mkdirSync(join(root, dirname(path)), { recursive: true });
  writeFileSync(join(root, path), content);
};

const git = (root, args) =>
  execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', HUSKY: '0' },
  }).trim();

const commit = (root, message) => {
  git(root, ['add', '-A']);
  git(root, ['-c', 'user.email=test@example.com', '-c', 'user.name=test', 'commit', '-m', message]);
  return git(root, ['rev-parse', 'HEAD']);
};

const createRepo = t => {
  const root = mkdtempSync(join(fileURLToPath(new URL('..', import.meta.url)), '.tmp-classify-docs-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const template = join(root, '.git-template');
  mkdirSync(join(template, 'hooks'), { recursive: true });
  git(root, ['init', '-b', 'main', `--template=${template}`]);

  // Marketing tabs.
  write(root, 'docs/introduction.md', page('Introduction'));
  write(root, 'docs/swap/index.mdx', page('Swap'));
  write(root, 'docs/home/why-sodax.md', page('Why SODAX'));
  write(root, 'docs/resources/blog.md', page('Blog'));
  write(root, 'docs/developers/faq.md', page('FAQ'));

  // Engineering tabs, generated and hand-written.
  write(root, 'docs/developers/how-to/estimate_gas.md', generated('Estimate Gas', 'packages/sdk/docs/ESTIMATE_GAS.md'));
  write(root, 'docs/developers/technical-overview/intro.md', page('Technical Overview'));
  write(root, 'docs/developers/http-api/swaps.md', page('Swaps API'));
  write(root, 'docs/solana/index.md', page('Solana'));

  write(root, 'docs/docs.json', '{ "navigation": [] }\n');
  write(root, 'docs/custom.css', ':root { --a: 1; }\n');
  write(root, 'docs/AGENTS.md', '# AGENTS\n');
  write(root, 'packages/sdk/src/index.ts', 'export const n = 1;\n');
  const base = commit(root, 'base');
  return { root, base };
};

const run = (root, base, head) => {
  try {
    const out = execFileSync('bash', [SCRIPT, base, head], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out };
  } catch (error) {
    return { code: error.status ?? 1, out: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
};

const classify = (root, base, head) => {
  const result = run(root, base, head);
  assert.equal(result.code, 0, result.out);
  return result.out;
};

test('true for an edited marketing page', t => {
  const { root, base } = createRepo(t);
  write(root, 'docs/introduction.md', page('Introduction', '').replace('## Introduction', '## Intro'));
  const head = commit(root, 'reword');

  assert.match(classify(root, base, head), /marketing_only=true/);
});

test('true across the marketing tabs, .md and .mdx', t => {
  const { root, base } = createRepo(t);
  write(root, 'docs/introduction.md', page('Introduction') + 'more\n');
  write(root, 'docs/swap/index.mdx', page('Swap') + 'more\n');
  write(root, 'docs/home/why-sodax.md', page('Why SODAX') + 'more\n');
  write(root, 'docs/resources/blog.md', page('Blog') + 'more\n');
  write(root, 'docs/developers/faq.md', page('FAQ') + 'more\n');
  const head = commit(root, 'reword five');

  assert.match(classify(root, base, head), /marketing_only=true/);
});

test('false for a hand-written feature page in an engineering tab', t => {
  const { root, base } = createRepo(t);
  write(root, 'docs/developers/technical-overview/intro.md', page('Technical Overview') + 'more\n');
  const head = commit(root, 'reword the technical overview');

  assert.match(
    classify(root, base, head),
    /marketing_only=false[\s\S]*technical-overview\/intro\.md is not a marketing-tab page/,
  );
});

test('false for an HTTP API page, hand-written but engineering-owned', t => {
  const { root, base } = createRepo(t);
  write(root, 'docs/developers/http-api/swaps.md', page('Swaps API') + 'more\n');
  const head = commit(root, 'reword the api page');

  assert.match(classify(root, base, head), /marketing_only=false[\s\S]*is not a marketing-tab page/);
});

test('false for a network guide', t => {
  const { root, base } = createRepo(t);
  write(root, 'docs/solana/index.md', page('Solana') + 'more\n');
  const head = commit(root, 'reword the solana guide');

  assert.match(classify(root, base, head), /marketing_only=false[\s\S]*solana\/index\.md is not a marketing-tab page/);
});

test('false when a marketing page rides along with a feature page', t => {
  const { root, base } = createRepo(t);
  write(root, 'docs/introduction.md', page('Introduction') + 'more\n');
  write(root, 'docs/developers/http-api/swaps.md', page('Swaps API') + 'more\n');
  const head = commit(root, 'marketing plus feature docs');

  assert.match(classify(root, base, head), /marketing_only=false[\s\S]*is not a marketing-tab page/);
});

test('false for a generated page, which the path allowlist alone would let through', t => {
  const { root } = createRepo(t);
  write(root, 'docs/developers/faq.md', generated('FAQ', 'packages/sdk/docs/FAQ.md'));
  const base = commit(root, 'faq becomes generated');
  write(root, 'docs/developers/faq.md', generated('FAQ', 'packages/sdk/docs/FAQ.md') + 'edit\n');
  const head = commit(root, 'edit the generated faq');

  assert.match(classify(root, base, head), /marketing_only=false[\s\S]*is generated, or its frontmatter is unreadable/);
});

test('false when a PR strips the generatedFrom key to qualify itself', t => {
  const { root } = createRepo(t);
  write(root, 'docs/developers/faq.md', generated('FAQ', 'packages/sdk/docs/FAQ.md'));
  const base = commit(root, 'faq becomes generated');
  write(root, 'docs/developers/faq.md', page('FAQ') + 'edit\n');
  const head = commit(root, 'drop generatedFrom');

  assert.match(classify(root, base, head), /marketing_only=false[\s\S]*is generated on/);
});

test('false when docs.json changes', t => {
  const { root, base } = createRepo(t);
  write(root, 'docs/introduction.md', page('Introduction') + 'more\n');
  write(root, 'docs/docs.json', '{ "navigation": [{ "page": "introduction" }] }\n');
  const head = commit(root, 'page plus nav');

  assert.match(classify(root, base, head), /marketing_only=false[\s\S]*docs\/docs\.json is not a marketing-tab page/);
});

test('false when custom.css changes', t => {
  const { root, base } = createRepo(t);
  write(root, 'docs/custom.css', ':root { --a: 2; }\n');
  const head = commit(root, 'restyle');

  assert.match(classify(root, base, head), /marketing_only=false[\s\S]*custom\.css is not a marketing-tab page/);
});

test('false when package source rides along', t => {
  const { root, base } = createRepo(t);
  write(root, 'docs/introduction.md', page('Introduction') + 'more\n');
  write(root, 'packages/sdk/src/index.ts', 'export const n = 2;\n');
  const head = commit(root, 'docs plus code');

  assert.match(
    classify(root, base, head),
    /marketing_only=false[\s\S]*packages\/sdk\/src\/index\.ts is not a marketing-tab page/,
  );
});

test('false for docs/AGENTS.md, which is not a published page', t => {
  const { root, base } = createRepo(t);
  write(root, 'docs/AGENTS.md', '# AGENTS\nmore\n');
  const head = commit(root, 'edit agent guidance');

  assert.match(classify(root, base, head), /marketing_only=false[\s\S]*AGENTS\.md is not a marketing-tab page/);
});

test('false for an added page, which has no nav entry', t => {
  const { root, base } = createRepo(t);
  write(root, 'docs/resources/glossary.md', page('Glossary'));
  const head = commit(root, 'add a page');

  assert.match(classify(root, base, head), /marketing_only=false[\s\S]*glossary\.md is A, not a modification/);
});

test('false for a deleted page, which strands a live URL', t => {
  const { root, base } = createRepo(t);
  rmSync(join(root, 'docs/introduction.md'));
  const head = commit(root, 'delete a page');

  assert.match(classify(root, base, head), /marketing_only=false[\s\S]*introduction\.md is D, not a modification/);
});

test('false for a renamed page, reported as delete plus add', t => {
  const { root, base } = createRepo(t);
  git(root, ['mv', 'docs/introduction.md', 'docs/overview.md']);
  const head = commit(root, 'rename a page');

  assert.match(classify(root, base, head), /marketing_only=false[\s\S]*not a modification/);
});

test('false for a page whose frontmatter cannot be parsed', t => {
  const { root, base } = createRepo(t);
  write(root, 'docs/introduction.md', '## Introduction\nno frontmatter\n');
  const head = commit(root, 'strip frontmatter');

  assert.match(classify(root, base, head), /marketing_only=false[\s\S]*is generated, or its frontmatter is unreadable/);
});

test('false for an empty diff', t => {
  const { root, base } = createRepo(t);

  assert.match(classify(root, base, base), /marketing_only=false[\s\S]*no files changed/);
});

test('writes the verdict to GITHUB_OUTPUT', t => {
  const { root, base } = createRepo(t);
  write(root, 'docs/introduction.md', page('Introduction') + 'more\n');
  const head = commit(root, 'reword');
  const outFile = join(root, 'gh-output');

  execFileSync('bash', [SCRIPT, base, head], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, GITHUB_OUTPUT: outFile },
  });

  assert.match(execFileSync('cat', [outFile], { encoding: 'utf8' }), /marketing_only=true/);
});
