import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Increments CONFIG_VERSION in @sodax/types by 1. Chained after `changeset version`
// in the `version:packages` script so a release bumps CONFIG_VERSION alongside the
// package versions — changesets does not touch source constants, only package.json
// and CHANGELOG.md. Previously handled by scripts/bump-versions.sh.

const TYPES_INDEX = join(process.cwd(), 'packages/types/src/index.ts');
const PATTERN = /(CONFIG_VERSION\s*=\s*)(\d+)/;

const source = readFileSync(TYPES_INDEX, 'utf8');
const match = source.match(PATTERN);

if (!match) {
  console.error(`Error: could not find CONFIG_VERSION in ${TYPES_INDEX}`);
  process.exit(1);
}

const current = Number(match[2]);
const next = current + 1;
writeFileSync(TYPES_INDEX, source.replace(PATTERN, `$1${next}`));

console.log(`  packages/types/src/index.ts → CONFIG_VERSION ${current} → ${next}`);
