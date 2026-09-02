import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const APPROVE = join(REPO, '.github/scripts/approve-docs-pr.sh');
const WITHDRAW = join(REPO, '.github/scripts/withdraw-docs-pr.sh');
const WORKFLOW = join(REPO, '.github/workflows/docs-auto-merge.yml');

const BOT = 'sodax-docs-publisher[bot]';
const CLASSIFIED = 'a'.repeat(40);
const PUSHED = 'b'.repeat(40);

// Answers the four reads the scripts make and logs every call, so a test can assert on both
// what was asked and what was mutated.
const GH_STUB = `#!/usr/bin/env bash
printf '%s\\n' "$*" >>"$GH_LOG"
if [ -n "\${GH_FAIL_ON:-}" ] && [[ "$*" == *"\$GH_FAIL_ON"* ]]; then
  echo "gh: refused \$*" >&2
  exit 1
fi
case "$*" in
  *headRefOid*) printf '%s\\n' "\${GH_HEAD_OID:-}" ;;
  *autoMergeRequest*) printf '%s\\n' "\${GH_AUTO_MERGE_BY:-}" ;;
  *dismissals*|*"-X POST"*|*--disable-auto*|*--auto*) : ;;
  */reviews*) printf '%s\\n' "\${GH_APPROVAL_IDS:-}" ;;
esac
`;

const runner = t => {
  const root = mkdtempSync(join(REPO, '.tmp-docs-auto-merge-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const bin = join(root, 'gh');
  writeFileSync(bin, GH_STUB);
  chmodSync(bin, 0o755);
  const log = join(root, 'gh.log');
  writeFileSync(log, '');

  return (script, args, env = {}) => {
    const options = {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PATH: `${root}:${process.env.PATH}`,
        GH_LOG: log,
        GITHUB_REPOSITORY: 'icon-project/sodax-sdks',
        ...env,
      },
    };

    let code = 0;
    try {
      execFileSync('bash', [script, ...args], options);
    } catch (error) {
      code = error.status ?? 1;
    }
    return { code, calls: readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) };
  };
};

const has = (calls, ...fragments) => calls.some(call => fragments.every(fragment => call.includes(fragment)));

test('approve pins both the review and the queued merge to the classified commit', t => {
  const gh = runner(t);
  const { code, calls } = gh(APPROVE, ['416', CLASSIFIED, '2 marketing page(s)'], { GH_HEAD_OID: CLASSIFIED });

  assert.equal(code, 0);
  assert.ok(has(calls, '-X POST', 'pulls/416/reviews', 'event=APPROVE', `commit_id=${CLASSIFIED}`));
  assert.ok(has(calls, 'pr merge', '416', '--auto', '--squash', `--match-head-commit ${CLASSIFIED}`));
});

// The race the head guard exists for: a push lands after the classifier read HEAD_SHA, and
// the run for that push cannot withdraw an approval filed after it.
test('approve does nothing once the head has moved past the classified commit', t => {
  const gh = runner(t);
  const { code, calls } = gh(APPROVE, ['416', CLASSIFIED, '2 marketing page(s)'], { GH_HEAD_OID: PUSHED });

  assert.equal(code, 0);
  assert.deepEqual(calls, ['pr view 416 --json headRefOid --jq .headRefOid']);
});

test('approve reads the live head before it mutates anything', t => {
  const gh = runner(t);
  const { calls } = gh(APPROVE, ['416', CLASSIFIED, '2 marketing page(s)'], { GH_HEAD_OID: CLASSIFIED });

  assert.match(calls[0], /headRefOid/);
});

// gh pr review has no way to name a commit, so an approval through it lands on whatever the
// head is at the time GitHub handles the call.
test('approve does not go through gh pr review', t => {
  const gh = runner(t);
  const { calls } = gh(APPROVE, ['416', CLASSIFIED, '2 marketing page(s)'], { GH_HEAD_OID: CLASSIFIED });

  assert.ok(!has(calls, 'pr review'));
});

test('approve carries the classifier reason into the review body', t => {
  const gh = runner(t);
  const { calls } = gh(APPROVE, ['416', CLASSIFIED, '3 marketing page(s)'], { GH_HEAD_OID: CLASSIFIED });

  assert.ok(has(calls, 'Marketing pages only (3 marketing page(s))'));
});

test('approve fails when the pinned merge is refused', t => {
  const gh = runner(t);
  const { code } = gh(APPROVE, ['416', CLASSIFIED, '2 marketing page(s)'], {
    GH_HEAD_OID: CLASSIFIED,
    GH_FAIL_ON: '--match-head-commit',
  });

  assert.notEqual(code, 0);
});

test('withdraw disarms the queued merge and dismisses the approval', t => {
  const gh = runner(t);
  const { code, calls } = gh(WITHDRAW, ['416', BOT, 'not a marketing page'], {
    GH_AUTO_MERGE_BY: BOT,
    GH_APPROVAL_IDS: '901',
  });

  assert.equal(code, 0);
  assert.ok(has(calls, 'pr merge', '416', '--disable-auto'));
  assert.ok(has(calls, '-X PUT', 'pulls/416/reviews/901/dismissals', 'event=DISMISS'));
});

// dismiss_stale_reviews_on_push flips the App's review to DISMISSED before this runs, so a
// guard keyed on a live approval would leave the queued merge armed for the next human one.
test('withdraw disarms the queued merge when the approval is already dismissed', t => {
  const gh = runner(t);
  const { code, calls } = gh(WITHDRAW, ['416', BOT, 'packages/sdk/src/index.ts is not a marketing-tab page'], {
    GH_AUTO_MERGE_BY: BOT,
    GH_APPROVAL_IDS: '',
  });

  assert.equal(code, 0);
  assert.ok(has(calls, 'pr merge', '416', '--disable-auto'));
  assert.ok(!has(calls, 'dismissals'));
});

test('withdraw leaves auto-merge a maintainer enabled by hand alone', t => {
  const gh = runner(t);
  const { code, calls } = gh(WITHDRAW, ['416', BOT, 'not a marketing page'], {
    GH_AUTO_MERGE_BY: 'gosiast',
    GH_APPROVAL_IDS: '',
  });

  assert.equal(code, 0);
  assert.ok(!has(calls, '--disable-auto'));
});

test('withdraw is a no-op when nothing on the pull request is the App’s', t => {
  const gh = runner(t);
  const { code, calls } = gh(WITHDRAW, ['416', BOT, 'not a marketing page'], {
    GH_AUTO_MERGE_BY: '',
    GH_APPROVAL_IDS: '',
  });

  assert.equal(code, 0);
  assert.ok(!has(calls, '--disable-auto'));
  assert.ok(!has(calls, 'dismissals'));
});

test('withdraw dismisses every approval the App still holds', t => {
  const gh = runner(t);
  const { calls } = gh(WITHDRAW, ['416', BOT, 'not a marketing page'], {
    GH_AUTO_MERGE_BY: '',
    GH_APPROVAL_IDS: '901\n902',
  });

  assert.ok(has(calls, 'pulls/416/reviews/901/dismissals'));
  assert.ok(has(calls, 'pulls/416/reviews/902/dismissals'));
});

test('withdraw selects approvals by the App login, so a maintainer review stands', t => {
  const gh = runner(t);
  const { calls } = gh(WITHDRAW, ['416', BOT, 'not a marketing page'], { GH_AUTO_MERGE_BY: '' });

  assert.ok(has(calls, 'pulls/416/reviews', 'APPROVED', BOT));
});

test('withdraw fails when disarming the queued merge is refused', t => {
  const gh = runner(t);
  const { code } = gh(WITHDRAW, ['416', BOT, 'not a marketing page'], {
    GH_AUTO_MERGE_BY: BOT,
    GH_FAIL_ON: '--disable-auto',
  });

  assert.notEqual(code, 0);
});

test('both scripts are committed executable, as the workflow invokes them directly', () => {
  for (const script of [APPROVE, WITHDRAW]) {
    assert.ok(statSync(script).mode & 0o111, `${script} is not executable`);
  }
});

// The head binding is only worth anything if the workflow hands over the SHA the classifier
// read rather than resolving the head again.
test('the workflow hands the approve script the SHA the classifier read', () => {
  const workflow = readFileSync(WORKFLOW, 'utf8');
  const steps = workflow.split(/^      - name: /m);
  const approve = steps.find(step => step.startsWith('Approve and queue the merge'));
  const classify = steps.find(step => step.startsWith('Classify the pull request diff'));

  assert.ok(approve && classify, 'the approve and classify steps are not both present');
  for (const step of [approve, classify]) {
    assert.match(step, /HEAD_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  }
  assert.match(approve, /\.github\/scripts\/approve-docs-pr\.sh "\$PR" "\$HEAD_SHA"/);
});

test('the workflow withdraws through the withdraw script', () => {
  const workflow = readFileSync(WORKFLOW, 'utf8');

  assert.match(workflow, /\.github\/scripts\/withdraw-docs-pr\.sh "\$PR" "\$BOT"/);
});
