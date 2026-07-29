import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Links in docs that sodax-document mirrors into GitBook must survive the mirror's
// move-and-rename step: a relative link is only safe when the target lands in the same
// destination directory under the same filename. Everything else must be an absolute
// sodax-sdks URL. See scripts/gitbook-sync-map.json for the mirror manifest.

const BLOB_BASE = 'https://github.com/icon-project/sodax-sdks/blob/main/';
const TREE_BASE = 'https://github.com/icon-project/sodax-sdks/tree/main/';
const SOURCE_URL = /^https:\/\/github\.com\/icon-project\/sodax-sdks\/(?:blob|tree)\/main\/([^?#]+)/;
const WRONG_REPO_URLS = [
  { pattern: 'github.com/icon-project/sodax-document/', hint: 'link to the sodax-sdks source file instead' },
  { pattern: 'github.com/icon-project/sodax-frontend/', hint: 'the repo was renamed to sodax-sdks' },
];

const stripCode = content => {
  let fenced = false;
  return content.split(/\r?\n/).map(line => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      return '';
    }
    if (fenced) return '';
    // Blank balanced inline-code spans so documented markdown examples aren't treated as links.
    return line.replace(/`[^`]*`/g, match => ' '.repeat(match.length));
  });
};

const collectTargets = line => {
  const targets = [];
  for (const match of line.matchAll(/\]\(\s*([^)\s]+)/g)) targets.push(match[1]);
  for (const match of line.matchAll(/href=["']([^"']+)["']/g)) targets.push(match[1]);
  for (const match of line.matchAll(/<(https?:\/\/[^>\s]+)>/g)) targets.push(match[1]);
  return targets;
};

const splitAnchor = target => {
  const hashIndex = target.indexOf('#');
  return hashIndex === -1 ? [target, ''] : [target.slice(0, hashIndex), target.slice(hashIndex)];
};

const decode = path => {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
};

const checkAbsolute = ({ target, inRepo }) => {
  const [url] = splitAnchor(target);

  const wrongRepo = WRONG_REPO_URLS.find(entry => url.includes(entry.pattern));
  if (wrongRepo) return `links into ${wrongRepo.pattern} — ${wrongRepo.hint}: ${url}`;

  const sourceUrl = url.match(SOURCE_URL);
  if (!sourceUrl) return null;

  const path = decode(sourceUrl[1]).replace(/\/$/, '');
  return inRepo(path) ? null : `links to ${path}, which does not exist in this repo: ${url}`;
};

const checkRelative = ({ target, srcDir, destDir, destBySrc, inRepo, isDir }) => {
  if (target.startsWith('/')) return `uses a root-relative link ${target}; use an absolute ${BLOB_BASE}… URL`;

  const [path, anchor] = splitAnchor(target);
  if (!path) return null;

  const resolvedSrc = posix.normalize(posix.join(srcDir, path));
  if (!inRepo(resolvedSrc)) return `links to missing ${resolvedSrc} (link target ${target})`;

  const mirroredDest = destBySrc.get(resolvedSrc);
  if (mirroredDest && mirroredDest === posix.normalize(posix.join(destDir, path))) return null;

  const base = isDir(resolvedSrc) ? TREE_BASE : BLOB_BASE;
  const reason = mirroredDest ? `the GitBook mirror moves it to ${mirroredDest}` : 'it is not mirrored into GitBook';
  return `relative link ${target} breaks on docs.sodax.com — ${reason}. Use ${base}${resolvedSrc}${anchor}`;
};

export const checkDocLinks = ({ root, manifestPath = 'scripts/gitbook-sync-map.json' } = {}) => {
  const failures = [];
  const absolute = path => join(root, path);
  const inRepo = path => existsSync(absolute(path));
  const isDir = path => inRepo(path) && statSync(absolute(path)).isDirectory();

  if (!inRepo(manifestPath)) {
    return { failures: [`Missing GitBook mirror manifest ${manifestPath}`], checked: 0, links: 0 };
  }

  const { mirrored } = JSON.parse(readFileSync(absolute(manifestPath), 'utf8'));
  const destBySrc = new Map(mirrored.map(entry => [entry.src, entry.dest]));
  let links = 0;

  for (const { src, dest } of mirrored) {
    if (!inRepo(src)) {
      // sodax-document copies this path with `cp -f` under `set -e`, so a rename here breaks the sync.
      failures.push(
        `${manifestPath} maps missing file ${src} (update the manifest and sodax-document/sync-sodax-sdks.sh together)`,
      );
      continue;
    }

    const context = { srcDir: posix.dirname(src), destDir: posix.dirname(dest), destBySrc, inRepo, isDir };

    stripCode(readFileSync(absolute(src), 'utf8')).forEach((line, index) => {
      for (const target of collectTargets(line)) {
        if (target.startsWith('#') || /^(mailto|tel):/i.test(target)) continue;
        links += 1;

        const isAbsolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(target);
        const problem = isAbsolute ? checkAbsolute({ target, inRepo }) : checkRelative({ ...context, target });

        if (problem) failures.push(`${src}:${index + 1} ${problem}`);
      }
    });
  }

  return { failures, checked: mirrored.length, links };
};

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const { failures, checked, links } = checkDocLinks({ root: process.cwd() });

  if (failures.length > 0) {
    console.error('GitBook-mirrored doc link validation failed:\n');
    for (const failure of failures) console.error(`- ${failure}`);
    console.error('\nRule: inside a mirrored doc a link may stay relative only when the target is mirrored');
    console.error(`into the same directory under the same name; otherwise use ${BLOB_BASE}<path>.`);
    process.exit(1);
  }

  console.log(`GitBook-mirrored doc link validation passed (${checked} mirrored files, ${links} links).`);
}
