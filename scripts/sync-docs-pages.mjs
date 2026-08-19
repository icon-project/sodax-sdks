import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// npm publishes package READMEs and module docs from the package, so the site gets a generated
// copy at its nav path; --check fails CI when a copy drifts from its source.

const MAP_FILE = 'scripts/gitbook-sync-map.json';
const DOCS_DIR = 'docs';

const stripExtension = path => path.replace(/\.mdx?$/, '');

const readMap = root => {
  const { mirrored } = JSON.parse(readFileSync(join(root, MAP_FILE), 'utf8'));
  // Entries already under docs/ are hand-authored site pages, not generated copies.
  return mirrored.filter(entry => !entry.src.startsWith(`${DOCS_DIR}/`));
};

const takeTitle = (body, entry) => {
  const lines = body.split(/\r?\n/);
  const index = lines.findIndex(line => line.trim());
  const heading = index === -1 ? null : lines[index].match(/^#\s+(.+?)\s*$/);
  if (!heading) {
    if (entry.title) return { title: entry.title, body };
    throw new Error(`${entry.src} has no H1 — add a "title" to its ${MAP_FILE} entry.`);
  }
  // The frontmatter title renders as the page H1, so the source heading would duplicate it.
  const rest = lines.slice(index + 1);
  while (rest.length && !rest[0].trim()) rest.shift();
  return { title: entry.title ?? heading[1], body: rest.join('\n') };
};

const rewriteLinks = (body, entry, destBySource) => {
  const sourceDir = posix.dirname(entry.src);
  return body.replace(/\]\(\s*(\.\/)?([^)\s:#]+\.mdx?)((?:#[^)\s]*)?)\s*\)/g, (match, _dot, target, anchor) => {
    const resolved = posix.normalize(posix.join(sourceDir, target));
    const dest = destBySource.get(resolved);
    if (!dest) throw new Error(`${entry.src} links to ${target}, which is not a page in ${MAP_FILE}.`);
    return `](/${stripExtension(dest)}${anchor})`;
  });
};

const render = (entry, root, destBySource) => {
  const source = readFileSync(join(root, entry.src), 'utf8');
  const { title, body } = takeTitle(source, entry);
  if (!entry.icon) throw new Error(`${entry.dest} has no "icon" in ${MAP_FILE} — every page carries one.`);
  const frontmatter = [
    '---',
    `title: ${JSON.stringify(title)}`,
    `icon: ${entry.icon}`,
    `# Generated from ${entry.src} by pnpm docs:sync-pages. Edit the source, not this file.`,
    '---',
    '',
    '',
  ].join('\n');
  return `${frontmatter}${rewriteLinks(body, entry, destBySource)}`;
};

export const syncDocsPages = ({ root, check = false } = {}) => {
  const entries = readMap(root);
  const destBySource = new Map(entries.map(entry => [entry.src, entry.dest]));
  const written = [];
  const stale = [];

  for (const entry of entries) {
    const target = join(root, DOCS_DIR, entry.dest);
    const content = render(entry, root, destBySource);
    const current = existsSync(target) ? readFileSync(target, 'utf8') : null;
    if (current === content) continue;

    if (check) {
      stale.push(`${DOCS_DIR}/${entry.dest} ${current === null ? 'is missing' : 'differs from'} ${entry.src}`);
      continue;
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
    written.push(`${DOCS_DIR}/${entry.dest}`);
  }

  return { entries: entries.length, written, stale };
};

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const check = process.argv.includes('--check');
  const { entries, written, stale } = syncDocsPages({ root: process.cwd(), check });

  if (stale.length > 0) {
    console.error('Generated docs pages are out of date:\n');
    for (const item of stale) console.error(`- ${item}`);
    console.error('\nRun `pnpm docs:sync-pages` and commit the result.');
    process.exit(1);
  }

  if (check) console.log(`Generated docs pages are up to date (${entries} pages).`);
  else
    console.log(
      `Generated ${written.length} of ${entries} docs pages${written.length ? `:\n${written.map(page => `- ${page}`).join('\n')}` : ' (all current).'}`,
    );
}
