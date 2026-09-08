import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const APPROVE = join(REPO, '.github/scripts/approve-docs-pr.sh');
const WITHDRAW = join(REPO, '.github/scripts/withdraw-docs-pr.sh');
const APP_NEEDED = join(REPO, '.github/scripts/docs-app-needed.sh');
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
  const output = join(root, 'github-output');
  writeFileSync(output, '');

  return (script, args, env = {}) => {
    const options = {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PATH: `${root}:${process.env.PATH}`,
        GH_LOG: log,
        GITHUB_OUTPUT: output,
        GITHUB_REPOSITORY: 'icon-project/sodax-sdks',
        ...env,
      },
    };

    let code = 0;
    let stdout = '';
    try {
      stdout = execFileSync('bash', [script, ...args], options);
    } catch (error) {
      code = error.status ?? 1;
    }
    return {
      code,
      stdout,
      output: readFileSync(output, 'utf8').trim(),
      calls: readFileSync(log, 'utf8').trim().split('\n').filter(Boolean),
    };
  };
};

const has = (calls, ...fragments) => calls.some(call => fragments.every(fragment => call.includes(fragment)));

const step = name => {
  const chunk = readFileSync(WORKFLOW, 'utf8')
    .split(/^      - name: /m)
    .find(candidate => candidate.startsWith(name));
  assert.ok(chunk, `the ${name} step is not present`);
  return chunk;
};

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

test('the workflow withdraws only on a run that minted a token', () => {
  const withdraw = step('Withdraw a stale approval');

  assert.match(withdraw, /steps\.app-token\.outcome == 'success'/);
});

test('marketing-only changes require an App token for approval', t => {
  const gh = runner(t);
  const { code, stdout, output, calls } = gh(APP_NEEDED, ['433', 'true']);
  assert.equal(code, 0);
  assert.equal(stdout.trim(), 'token_required=true');
  assert.equal(output, 'token_required=true');
  assert.deepEqual(calls, []);
});

test('non-marketing changes with no queued merge or bot approval need no App token', t => {
  const gh = runner(t);
  const { code, stdout, output, calls } = gh(APP_NEEDED, ['433', 'false'], { GH_AUTO_MERGE_BY: 'false' });
  assert.equal(code, 0);
  assert.equal(stdout.trim(), 'token_required=false');
  assert.equal(output, 'token_required=false');
  assert.ok(has(calls, 'pr view', 'autoMergeRequest'));
  assert.ok(has(calls, '--paginate', '/reviews', 'APPROVED', 'Bot'));
  assert.ok(!has(calls, '-X'));
});

test('a queued merge requires cleanup even when its approval was already dismissed', t => {
  const gh = runner(t);
  const { code, stdout } = gh(APP_NEEDED, ['433', 'false'], {
    GH_AUTO_MERGE_BY: 'true',
    GH_APPROVAL_IDS: '',
  });
  assert.equal(code, 0);
  assert.equal(stdout.trim(), 'token_required=true');
});

test('a bot approval requires cleanup even if queuing auto-merge never succeeded', t => {
  const gh = runner(t);
  const { code, stdout } = gh(APP_NEEDED, ['433', 'false'], {
    GH_AUTO_MERGE_BY: 'false',
    GH_APPROVAL_IDS: '901\n902',
  });
  assert.equal(code, 0);
  assert.equal(stdout.trim(), 'token_required=true');
});

for (const failedRead of ['autoMergeRequest', '/reviews']) {
  test(`a failed ${failedRead} read does not declare a PR safe to skip`, t => {
    const gh = runner(t);
    const { code, stdout } = gh(APP_NEEDED, ['433', 'false'], {
      GH_AUTO_MERGE_BY: 'false',
      GH_FAIL_ON: failedRead,
    });
    assert.notEqual(code, 0);
    assert.equal(stdout, '');
  });
}

test('an unexpected auto-merge response fails closed', t => {
  const gh = runner(t);
  const { code, stdout } = gh(APP_NEEDED, ['433', 'false'], { GH_AUTO_MERGE_BY: '' });
  assert.notEqual(code, 0);
  assert.equal(stdout, '');
});

test('an invalid eligibility input fails closed', t => {
  const gh = runner(t);
  const { code, stdout } = gh(APP_NEEDED, ['433', 'unknown']);
  assert.notEqual(code, 0);
  assert.equal(stdout, '');
});

test('classification precedes token selection and cannot be skipped by a docs-only scope gate', () => {
  const workflow = readFileSync(WORKFLOW, 'utf8');
  assert.ok(workflow.indexOf('name: Classify the pull request diff') < workflow.indexOf('name: Mint an App token'));
  assert.doesNotMatch(step('Classify the pull request diff'), /\n        if:/);
  assert.match(step('Check whether an App token is needed'), /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(workflow, /pull-requests: read/);
  assert.doesNotMatch(workflow, /steps\.scope/);
});

test('classification failures still allow token selection and cleanup, but never approval', () => {
  const check = step('Check whether an App token is needed');
  const mint = step('Mint an App token');
  const withdraw = step('Withdraw a stale approval');
  assert.match(check, /!cancelled\(\)/);
  assert.match(check, /steps\.classify\.outcome == 'success' && steps\.classify\.outputs\.marketing_only == 'true'/);
  assert.match(mint, /!cancelled\(\)/);
  assert.match(mint, /steps\.app-needed\.outcome == 'success' && steps\.app-needed\.outputs\.token_required == 'true'/);
  assert.match(withdraw, /!cancelled\(\)/);
  assert.match(
    withdraw,
    /steps\.classify\.outcome != 'success' \|\| steps\.classify\.outputs\.marketing_only != 'true'/,
  );
  assert.doesNotMatch(step('Approve and queue the merge'), /!cancelled\(\)|always\(\)|continue-on-error/);
});

const credentialsGate = () =>
  step('Check the App credentials are provisioned')
    .split('        run: |\n')[1]
    .split('\n')
    .filter(line => line.startsWith('          '))
    .map(line => line.slice(10))
    .join('\n');

for (const marketing of [true, false]) {
  for (const credentials of ['both', 'neither', 'id-only', 'key-only']) {
    test(`credentials gate: marketing=${marketing}, credentials=${credentials}`, t => {
      const root = mkdtempSync(join(REPO, '.tmp-docs-creds-'));
      t.after(() => rmSync(root, { recursive: true, force: true }));
      const output = join(root, 'output');
      writeFileSync(output, '');
      const present = credentials === 'both';
      let code = 0;
      let stdout = '';
      try {
        stdout = execFileSync('bash', ['-c', credentialsGate()], {
          encoding: 'utf8',
          env: {
            ...process.env,
            GITHUB_OUTPUT: output,
            MARKETING_ONLY: String(marketing),
            APP_ID: ['both', 'id-only'].includes(credentials) ? 'test-id' : '',
            APP_KEY: ['both', 'key-only'].includes(credentials) ? 'test-key' : '',
          },
        });
      } catch (error) {
        code = error.status;
        stdout = error.stdout;
      }
      assert.equal(code, present || marketing ? 0 : 1);
      assert.equal(readFileSync(output, 'utf8').trim(), `present=${present}`);
      if (!present) assert.match(stdout, marketing ? /::warning::/ : /::error::/);
      assert.doesNotMatch(stdout, /test-id|test-key/);
    });
  }
}

test('token mint requires credentials and credential checks still run for cleanup after failure', () => {
  assert.match(step('Check the App credentials are provisioned'), /!cancelled\(\)/);
  assert.match(
    step('Check the App credentials are provisioned'),
    /steps\.app-needed\.outputs\.token_required == 'true'/,
  );
  assert.match(
    step('Mint an App token'),
    /steps\.creds\.outcome == 'success' && steps\.creds\.outputs\.present == 'true'/,
  );
});
