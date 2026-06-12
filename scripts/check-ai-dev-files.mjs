import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const failures = [];

const read = path => readFileSync(join(root, path), 'utf8');
const exists = path => existsSync(join(root, path));

function fail(message) {
  failures.push(message);
}

function listWorkspaceDirs(base) {
  if (!exists(base)) return [];
  return readdirSync(join(root, base))
    .map(name => `${base}/${name}`)
    .filter(path => statSync(join(root, path)).isDirectory());
}

const agentFiles = ['AGENTS.md'];
const claudeFiles = ['CLAUDE.md'];

for (const dir of [...listWorkspaceDirs('packages'), ...listWorkspaceDirs('apps')]) {
  const agentsPath = `${dir}/AGENTS.md`;
  const claudePath = `${dir}/CLAUDE.md`;
  if (exists(agentsPath) || exists(claudePath)) {
    agentFiles.push(agentsPath);
    claudeFiles.push(claudePath);
  }
}

for (const path of agentFiles) {
  if (!exists(path)) fail(`Missing ${path}`);
}

for (const path of claudeFiles) {
  if (!exists(path)) {
    fail(`Missing ${path}`);
    continue;
  }

  const content = read(path);
  const firstInstruction = content
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(Boolean);

  if (firstInstruction !== '@AGENTS.md') {
    fail(`${path} must import sibling AGENTS.md as its first non-empty line`);
  }

  const lineCount = content.trimEnd().split(/\r?\n/).length;
  if (lineCount > 10) {
    fail(`${path} should stay a thin Claude shim; found ${lineCount} lines`);
  }
}

const rootAgents = read('AGENTS.md');
const routedGuides = [...rootAgents.matchAll(/\]\(((?:packages|apps)\/[^)]+\/AGENTS\.md)\)/g)].map(match => match[1]);
for (const path of routedGuides) {
  if (!exists(path)) fail(`Root AGENTS.md routes to missing ${path}`);
}

for (const path of agentFiles) {
  if (!exists(path)) continue;
  const content = read(path);
  const lineCount = content.trimEnd().split(/\r?\n/).length;
  const maxLines = path === 'AGENTS.md' ? 150 : 220;
  if (lineCount > maxLines) {
    fail(`${path} is ${lineCount} lines; keep agent guidance under ${maxLines} lines`);
  }

  const volatilePatterns = [
    /\bacross\s+\d+\s+blockchains\b/i,
    /\bEVM\s*\(\d+\)/,
    /\bNon-EVM\s*\(\d+\)/,
    /\b\d+\s+chains\b/i,
    /\ball\s+\d+\s+chains\b/i,
    /\bissue\s+#\d+\b/i,
    /\bparent\s+issue\s+#\d+\b/i,
    /#\d+/,
    /\bformerly\b/i,
    /\btoday:\s*\d+/i,
  ];

  for (const pattern of volatilePatterns) {
    if (pattern.test(content)) {
      fail(`${path} contains volatile AI-guidance text matching ${pattern}`);
    }
  }
}

for (const path of routedGuides) {
  const dir = path.slice(0, -'/AGENTS.md'.length);
  const rel = relative(root, join(root, dir, 'CLAUDE.md'));
  if (!exists(rel)) fail(`${path} should have a sibling CLAUDE.md shim`);
}

if (failures.length > 0) {
  console.error('AI dev file validation failed:\n');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `AI dev file validation passed (${agentFiles.length} AGENTS.md files, ${claudeFiles.length} CLAUDE.md shims).`,
);
