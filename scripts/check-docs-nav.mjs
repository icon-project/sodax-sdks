import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Mintlify publishes with warnings, so a nav entry without a file (a sidebar 404) and a file
// without a nav entry (published, but out of sidebar/search/llms.txt) both ship silently.

const DOCS_DIR = 'docs';
const CONFIG_FILE = 'docs.json';
const IGNORE_FILE = '.mintignore';
const PAGE_EXTENSIONS = ['.mdx', '.md'];
// Mintlify skips these without any configuration.
const DEFAULT_IGNORED_FILES = ['README.md', 'LICENSE.md', 'CHANGELOG.md'];
const DEFAULT_IGNORED_DIRS = [
  '.git',
  '.github',
  '.idea',
  '.vscode',
  'node_modules',
  'build',
  'dist',
  '.cache',
  'snippets',
];

// Supports the .gitignore subset Mintlify documents: "!" negation, "/" anchor and directory
// suffix, "*" within a segment, "**" across segments.
const patternToRegExp = pattern => {
  const anchored = pattern.startsWith('/');
  const body = anchored ? pattern.slice(1) : pattern;
  const source = body
    .split('/')
    .map(segment => {
      if (segment === '**') return '.*';
      return segment
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '[^/]');
    })
    .join('/');
  // An unanchored pattern matches at any depth, the way .gitignore treats "AGENTS.md".
  return new RegExp(`^${anchored ? '' : '(?:.*/)?'}${source}(?:/.*)?$`);
};

const parseIgnoreFile = content =>
  content
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .map(line => {
      const negated = line.startsWith('!');
      const pattern = (negated ? line.slice(1) : line).replace(/\/$/, '');
      return { negated, matches: patternToRegExp(pattern) };
    });

const isIgnored = (relPath, rules) => {
  let ignored = false;
  for (const rule of rules) {
    if (rule.matches.test(relPath)) ignored = !rule.negated;
  }
  return ignored;
};

// Page references only live in "pages" arrays; other strings are labels, icons and tab names.
const collectNavPages = node => {
  const pages = [];
  const walk = (value, inPages) => {
    if (typeof value === 'string') {
      if (inPages) pages.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item, inPages);
      return;
    }
    if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) walk(child, key === 'pages');
    }
  };
  walk(node, false);
  return pages;
};

const listPageFiles = (dir, rules, base = dir) => {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const absolute = join(dir, entry);
    const relPath = relative(base, absolute).split(sep).join(posix.sep);
    if (statSync(absolute).isDirectory()) {
      if (DEFAULT_IGNORED_DIRS.includes(entry)) continue;
      if (isIgnored(relPath, rules)) continue;
      found.push(...listPageFiles(absolute, rules, base));
      continue;
    }
    const extension = PAGE_EXTENSIONS.find(candidate => entry.endsWith(candidate));
    if (!extension) continue;
    if (DEFAULT_IGNORED_FILES.includes(entry)) continue;
    if (isIgnored(relPath, rules)) continue;
    found.push(relPath.slice(0, -extension.length));
  }
  return found;
};

export const checkDocsNav = ({ root, docsDir = DOCS_DIR } = {}) => {
  const docsPath = join(root, docsDir);
  const configPath = join(docsPath, CONFIG_FILE);
  if (!existsSync(configPath)) {
    return { failures: [`${docsDir}/${CONFIG_FILE} is missing — cannot verify navigation.`], navPages: 0, files: 0 };
  }

  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const ignorePath = join(docsPath, IGNORE_FILE);
  const rules = existsSync(ignorePath) ? parseIgnoreFile(readFileSync(ignorePath, 'utf8')) : [];

  const navPages = [
    ...new Set(collectNavPages(config.navigation ?? {}).filter(page => !/^[a-z][a-z0-9+.-]*:/i.test(page))),
  ];
  const files = listPageFiles(docsPath, rules);
  const fileSet = new Set(files);
  const navSet = new Set(navPages);

  const failures = [];
  for (const page of navPages.filter(page => !fileSet.has(page)).sort()) {
    failures.push(
      `${docsDir}/${CONFIG_FILE} navigates to "${page}" but no ${docsDir}/${page}.mdx|.md exists — that is a 404 in the sidebar.`,
    );
  }
  for (const file of files.filter(file => !navSet.has(file)).sort()) {
    failures.push(
      `${docsDir}/${file} is published but absent from ${CONFIG_FILE} navigation — add a nav entry, or add the file to ${docsDir}/${IGNORE_FILE} if it should not be on the site.`,
    );
  }

  return { failures, navPages: navPages.length, files: files.length };
};

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const { failures, navPages, files } = checkDocsNav({ root: process.cwd() });

  if (failures.length > 0) {
    console.error('Docs navigation check failed:\n');
    for (const failure of failures) console.error(`- ${failure}`);
    console.error(`\nSee ${DOCS_DIR}/README.md for how pages, URLs and navigation relate.`);
    process.exit(1);
  }

  console.log(`Docs navigation check passed (${navPages} nav entries, ${files} published pages).`);
}
