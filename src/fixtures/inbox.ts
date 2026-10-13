// Inbox fixtures for the dev harness (`app.html?fixtures=1#/inbox`): every default view (Graphite's sections, with the
// filters the section editor shows), covering each review, CI and merge state a row can show, native stack positions,
// unread rows, long titles, labels, team and bot reviewers, and one row of globex's, the viewer's other organization. The
// viewer is octocat. Ages are relative to page load so the harness always looks current. Each row has its checks, which
// the fixture source hands out only as GitHub would: the dashboard's rollup at first, the list (with the required ones)
// when enriching a failing rollup. The rows in "Needs anyone's review" have no line counts and no merge state. The native
// stacks' rows chain by branch, which only enriching an open row names ("Group by stack").
import type { Fixtures, InboxFixtureRow } from '../app/data-source';
import type { CheckRunSummary, CheckState, CiSummary, UserRef } from '../lib/model';
import { DEFAULT_VIEWS } from '../lib/views';

const NOW = Date.now();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const octocat: UserRef = { login: 'octocat', avatarUrl: 'https://avatars.githubusercontent.com/u/583231?v=4', url: 'https://github.com/octocat' };
const mona: UserRef = { login: 'mona', avatarUrl: 'https://avatars.githubusercontent.com/u/990000101?v=4', url: 'https://github.com/mona' };
const priya: UserRef = { login: 'priya-s', avatarUrl: 'https://avatars.githubusercontent.com/u/990000102?v=4', url: 'https://github.com/priya-s' };
const nat: UserRef = { login: 'nat-k', avatarUrl: 'https://avatars.githubusercontent.com/u/990000103?v=4', url: 'https://github.com/nat-k' };
const jdoe: UserRef = { login: 'jdoe', avatarUrl: 'https://avatars.githubusercontent.com/u/990000104?v=4', url: 'https://github.com/jdoe' };
const kenji: UserRef = { login: 'kenji-w', avatarUrl: 'https://avatars.githubusercontent.com/u/990000105?v=4', url: 'https://github.com/kenji-w' };
const platformTeam: UserRef = { login: 'acme/platform-reviewers', avatarUrl: '', url: 'https://github.com/orgs/acme/teams/platform-reviewers' };
const designTeam: UserRef = { login: 'acme/design-systems', avatarUrl: '', url: 'https://github.com/orgs/acme/teams/design-systems' };
// Bots as GitHub names them: Copilot's review and Dependabot's PRs come without an avatar here, and acme's own CI bot has none.
const copilot: UserRef = { login: 'Copilot', avatarUrl: '', url: 'https://github.com/apps/copilot-pull-request-reviewer' };
const dependabot: UserRef = { login: 'dependabot[bot]', avatarUrl: '', url: 'https://github.com/apps/dependabot' };
const acmeBot: UserRef = { login: 'acme-ci[bot]', avatarUrl: '', url: 'https://github.com/apps/acme-ci' };

export const inboxFixtures: Fixtures['inbox'] = DEFAULT_VIEWS.map((view) => {
  const prs = prsFor(view.id);
  // As in the user's inbox, more merged in a week than the section lists, which its count shows as 99+.
  const totalCount = view.id === 'graphite-merging-and-recently-merged' ? 141 : prs.length;
  return { view, prs, totalCount, fetchedAt: new Date(NOW).toISOString() };
});

/** The pages after the first: "Merging and recently merged" goes on, as the user's does, for "Load more". */
export const inboxPageFixtures: Fixtures['inboxPages'] = {
  'graphite-merging-and-recently-merged': [
    ['Cache the tenant settings lookup', 'Fix the date picker on Safari 17', 'Rename the billing feature flags', 'Drop the legacy CSV importer', 'Add retries to the webhook sender'],
    ['Pin the Playwright browsers', 'Log slow queries over 500 ms', 'Move the icons into @acme/ui'],
  ].map((titles, page) =>
    titles.map((title, index) => {
      const age = (3.5 + page * 2.5 + index * 0.5) * DAY;
      return pr({
        repo: index % 2 ? 'acme/platform' : 'acme/widgets',
        number: 380 - page * 10 - index,
        title,
        author: [mona, priya, nat, jdoe, kenji][index]!,
        updated: age,
        state: 'MERGED',
        mergedAt: new Date(NOW - age).toISOString(),
        reviewDecision: 'APPROVED',
        reviewers: [{ kind: 'user', user: octocat, state: 'APPROVED' }],
        ci: ci({ passed: 10 }),
        mergeStatus: 'UNKNOWN',
        additions: 20 + index * 37,
        deletions: 5 + index * 11,
      });
    }),
  ),
};

function prsFor(viewId: string): InboxFixtureRow[] {
  switch (viewId) {
    case 'graphite-needs-your-review':
      return [
        pr({
          repo: 'acme/widgets',
          number: 412,
          title: 'Add keyboard navigation to the command palette',
          author: mona,
          updated: 25 * MINUTE,
          unread: true,
          reviewers: [{ kind: 'user', user: octocat, state: 'PENDING' }, { kind: 'user', user: copilot, state: 'COMMENTED' }],
          ci: ci({ passed: 8, pending: ['e2e (chromium)', 'deploy-preview'] }),
          mergeBlockedReason: 'At least 1 approving review is required by reviewers with write access',
          additions: 214,
          deletions: 38,
          changedFiles: 9,
          commentCount: 3,
          labels: [
            { name: 'enhancement', color: 'a2eeef' },
            { name: 'accessibility', color: '0e8a16' },
          ],
        }),
        pr({
          repo: 'acme/platform',
          number: 1287,
          title: 'Migrate session storage from Redis to DynamoDB with dual writes, a backfill job for existing tenants and a kill switch',
          author: priya,
          updated: 5 * HOUR,
          reviewers: [{ kind: 'team', user: platformTeam, state: 'PENDING' }, { kind: 'user', user: octocat, state: 'PENDING' }],
          ci: ci({ passed: 11, failed: ['integration (postgres-15)'] }),
          requiredCheckNames: ['build', 'integration (postgres-15)'],
          additions: 1240,
          deletions: 612,
          changedFiles: 47,
          commentCount: 14,
          labels: [
            { name: 'infra', color: '5319e7' },
            { name: 'breaking change', color: 'b60205' },
            { name: 'needs migration', color: 'fbca04' },
            { name: 'size/XL', color: 'ededed' },
            { name: 'backend', color: '1d76db' },
          ],
        }),
        pr({
          repo: 'acme/api',
          number: 88,
          title: 'Rate-limit webhook retries per installation',
          author: jdoe,
          updated: 20 * HOUR,
          unread: true,
          reviewers: [
            { kind: 'user', user: octocat, state: 'PENDING' },
            { kind: 'user', user: kenji, state: 'COMMENTED' },
            { kind: 'user', user: acmeBot, state: 'COMMENTED' },
            { kind: 'team', user: platformTeam, state: 'PENDING' },
          ],
          ci: ci({ pending: ['build', 'lint', 'unit (node 22)'] }),
          additions: 96,
          deletions: 14,
          commentCount: 1,
          labels: [{ name: 'bug', color: 'd73a4a' }],
        }),
        pr({
          repo: 'acme/widgets',
          number: 409,
          title: 'Extract DatePicker into @acme/ui',
          author: nat,
          updated: 2 * DAY + 4 * HOUR,
          nativeStack: { position: 2, size: 4 },
          headRefName: 'nat/extract-date-picker',
          baseRefName: 'nat/date-picker-tokens',
          reviewers: [{ kind: 'user', user: octocat, state: 'PENDING' }],
          ci: ci({ passed: 10 }),
          additions: 320,
          deletions: 290,
          changedFiles: 14,
          labels: [{ name: 'refactor', color: 'c5def5' }],
        }),
        pr({
          repo: 'acme/widgets',
          number: 410,
          title: 'Use the shared DatePicker in the booking flow',
          author: nat,
          updated: 3 * DAY,
          nativeStack: { position: 3, size: 4 },
          headRefName: 'nat/booking-date-picker',
          baseRefName: 'nat/extract-date-picker',
          reviewers: [{ kind: 'user', user: octocat, state: 'PENDING' }],
          ci: ci({ passed: 9, skipped: ['deploy-preview'] }),
          additions: 88,
          deletions: 141,
          commentCount: 2,
        }),
        // Another of octocat's organizations: shown when the inbox shows globex.
        pr({
          repo: 'globex/billing',
          number: 77,
          title: 'Prorate plan changes mid-cycle',
          author: jdoe,
          updated: 4 * HOUR,
          unread: true,
          reviewers: [{ kind: 'user', user: octocat, state: 'PENDING' }],
          ci: ci({ passed: 6 }),
          additions: 133,
          deletions: 21,
        }),
      ];
    case 'graphite-needs-anyones-review':
      return [
        pr({
          repo: 'acme/platform',
          number: 1293,
          title: 'Bump the Terraform AWS provider to v6',
          author: dependabot,
          updated: 2 * HOUR,
          unread: true,
          reviewers: [{ kind: 'team', user: platformTeam, state: 'PENDING' }],
          ci: ci({ passed: 6, pending: ['deploy-preview'] }),
          mergeStatus: 'UNKNOWN',
          changedFiles: 0,
          labels: [{ name: 'dependencies', color: '0366d6' }],
        }),
        pr({
          repo: 'acme/widgets',
          number: 416,
          title: 'Tighten spacing scale in the dense table variant',
          author: mona,
          updated: 9 * HOUR,
          reviewers: [{ kind: 'team', user: designTeam, state: 'PENDING' }, { kind: 'user', user: nat, state: 'APPROVED' }],
          ci: ci({ passed: 10 }),
          mergeStatus: 'UNKNOWN',
          changedFiles: 0,
          commentCount: 1,
          labels: [{ name: 'design system', color: '7057ff' }],
        }),
      ];
    case 'graphite-returned-to-you':
      return [
        pr({
          repo: 'acme/widgets',
          number: 398,
          title: 'Debounce search input on the dashboard',
          author: octocat,
          updated: 1 * HOUR,
          unread: true,
          reviewDecision: 'CHANGES_REQUESTED',
          reviewers: [{ kind: 'user', user: mona, state: 'CHANGES_REQUESTED' }],
          ci: ci({ passed: 10 }),
          mergeStatus: 'DIRTY',
          additions: 45,
          deletions: 12,
          commentCount: 6,
        }),
        pr({
          repo: 'acme/platform',
          number: 1270,
          title: 'Add CSV export to the audit log',
          author: octocat,
          updated: 1 * DAY,
          reviewDecision: 'CHANGES_REQUESTED',
          reviewers: [{ kind: 'user', user: priya, state: 'CHANGES_REQUESTED' }, { kind: 'user', user: jdoe, state: 'APPROVED' }],
          ci: ci({ passed: 9, failed: ['lint', 'typecheck'] }),
          requiredCheckNames: ['build', 'lint', 'typecheck'],
          mergeStatus: 'UNSTABLE',
          additions: 402,
          deletions: 20,
          changedFiles: 12,
          commentCount: 9,
          labels: [{ name: 'enhancement', color: 'a2eeef' }],
        }),
      ];
    case 'graphite-approved':
      return [
        pr({
          repo: 'acme/widgets',
          number: 401,
          title: 'Bump eslint to v10 and fix the new lint errors',
          author: octocat,
          updated: 3 * HOUR,
          reviewDecision: 'APPROVED',
          reviewers: [{ kind: 'user', user: nat, state: 'APPROVED' }],
          ci: ci({ passed: 10 }),
          mergeStatus: 'CLEAN',
          additions: 88,
          deletions: 102,
          changedFiles: 23,
          commentCount: 1,
          labels: [{ name: 'dependencies', color: '0366d6' }],
        }),
        pr({
          repo: 'acme/platform',
          number: 1262,
          title: 'Paginate the tenant list endpoint',
          author: octocat,
          updated: 2 * DAY,
          reviewDecision: 'APPROVED',
          reviewers: [{ kind: 'user', user: priya, state: 'APPROVED' }, { kind: 'user', user: kenji, state: 'APPROVED' }],
          ci: ci({ passed: 12 }),
          mergeStatus: 'BEHIND',
          additions: 156,
          deletions: 40,
          commentCount: 4,
        }),
        pr({
          repo: 'acme/widgets',
          number: 407,
          title: 'Add stack layout primitives',
          author: octocat,
          updated: 6 * HOUR,
          nativeStack: { position: 1, size: 3 },
          headRefName: 'octocat/stack-layout-primitives',
          reviewDecision: 'APPROVED',
          reviewers: [{ kind: 'user', user: mona, state: 'APPROVED' }],
          ci: ci({ passed: 8, pending: ['e2e (webkit)'] }),
          autoMerge: { method: 'SQUASH' },
          additions: 260,
          deletions: 12,
          commentCount: 2,
        }),
      ];
    case 'graphite-drafts':
      return [
        pr({
          repo: 'acme/widgets',
          number: 415,
          title: 'WIP: try view transitions between routes',
          author: octocat,
          updated: 40 * MINUTE,
          isDraft: true,
          reviewDecision: 'NONE',
          ci: ci({}),
          mergeStatus: 'DRAFT',
          additions: 73,
          deletions: 9,
        }),
        pr({
          repo: 'acme/widgets',
          number: 413,
          title: 'Use stack layout in settings',
          author: octocat,
          updated: 6 * HOUR,
          isDraft: true,
          nativeStack: { position: 3, size: 3 },
          headRefName: 'octocat/stack-layout-settings',
          baseRefName: 'octocat/stack-layout-account',
          reviewDecision: 'NONE',
          ci: ci({ passed: 4, failed: ['e2e (chromium)'] }),
          requiredCheckNames: ['build'],
          mergeStatus: 'DRAFT',
          additions: 51,
          deletions: 30,
        }),
      ];
    case 'graphite-waiting-for-reviewers':
      return [
        pr({
          repo: 'acme/platform',
          number: 1290,
          title: 'Emit tracing spans for background jobs',
          author: octocat,
          updated: 12 * MINUTE,
          reviewers: [{ kind: 'user', user: priya, state: 'PENDING' }],
          ci: ci({ passed: 12 }),
          mergeStatus: 'HAS_HOOKS',
          additions: 210,
          deletions: 35,
        }),
        pr({
          repo: 'acme/widgets',
          number: 411,
          title: 'Add focus ring tokens',
          author: octocat,
          updated: 4 * HOUR,
          reviewers: [{ kind: 'team', user: designTeam, state: 'PENDING' }, { kind: 'user', user: mona, state: 'PENDING' }],
          ci: ci({ passed: 10, failed: ['visual-regression'] }),
          requiredCheckNames: ['build', 'lint'],
          additions: 64,
          deletions: 8,
          labels: [{ name: 'design system', color: '7057ff' }],
        }),
        pr({
          repo: 'acme/widgets',
          number: 408,
          title: 'Use stack layout on the account page',
          author: octocat,
          updated: 6 * HOUR,
          nativeStack: { position: 2, size: 3 },
          headRefName: 'octocat/stack-layout-account',
          baseRefName: 'octocat/stack-layout-primitives',
          reviewers: [{ kind: 'user', user: mona, state: 'PENDING' }],
          ci: ci({ passed: 9, skipped: ['deploy-preview'] }),
          additions: 140,
          deletions: 76,
          commentCount: 1,
        }),
        pr({
          repo: 'acme/api',
          number: 91,
          title: 'Return 409 on a reused idempotency key',
          author: octocat,
          updated: 1 * DAY,
          reviewers: [{ kind: 'user', user: jdoe, state: 'PENDING' }, { kind: 'user', user: copilot, state: 'COMMENTED' }],
          ci: ci({ passed: 7, failed: ['unit (node 22)', 'integration (postgres-15)'] }),
          requiredCheckNames: ['build', 'unit (node 22)'],
          mergeStatus: 'UNSTABLE',
          mergeBlockedReason: 'Required status check "unit (node 22)" is failing',
          additions: 130,
          deletions: 22,
        }),
      ];
    case 'graphite-merging-and-recently-merged':
      return [
        pr({
          repo: 'acme/widgets',
          number: 406,
          title: 'Add stack layout tokens',
          author: octocat,
          updated: 8 * MINUTE,
          reviewDecision: 'APPROVED',
          reviewers: [{ kind: 'user', user: mona, state: 'APPROVED' }],
          ci: ci({ passed: 10 }),
          mergeStatus: 'CLEAN',
          isInMergeQueue: true,
          autoMerge: { method: 'SQUASH' },
          additions: 42,
          deletions: 3,
        }),
        pr({
          repo: 'acme/widgets',
          number: 395,
          title: 'Fix the flaky checkout e2e test',
          author: octocat,
          updated: 1 * DAY,
          state: 'MERGED',
          mergedAt: new Date(NOW - DAY).toISOString(),
          reviewDecision: 'APPROVED',
          reviewers: [{ kind: 'user', user: nat, state: 'APPROVED' }],
          ci: ci({ passed: 10 }),
          mergeStatus: 'UNKNOWN',
          additions: 18,
          deletions: 27,
          commentCount: 2,
        }),
        pr({
          repo: 'acme/platform',
          number: 1251,
          title: 'Drop Node 18 support',
          author: octocat,
          updated: 3 * DAY,
          state: 'MERGED',
          mergedAt: new Date(NOW - 3 * DAY).toISOString(),
          reviewDecision: 'APPROVED',
          reviewers: [{ kind: 'user', user: priya, state: 'APPROVED' }, { kind: 'team', user: platformTeam, state: 'APPROVED' }],
          ci: ci({ passed: 12 }),
          mergeStatus: 'UNKNOWN',
          additions: 35,
          deletions: 188,
          commentCount: 5,
          labels: [{ name: 'breaking change', color: 'b60205' }],
        }),
      ];
    case 'graphite-waiting-for-author':
      return [
        pr({
          repo: 'acme/api',
          number: 86,
          title: 'Stream large exports to S3 instead of buffering them',
          author: kenji,
          updated: 3 * HOUR,
          reviewDecision: 'REVIEW_REQUIRED',
          reviewers: [
            { kind: 'user', user: octocat, state: 'APPROVED' },
            { kind: 'user', user: mona, state: 'PENDING' },
          ],
          ci: ci({ passed: 9 }),
          mergeBlockedReason: 'At least 2 approving reviews are required by reviewers with write access',
          additions: 180,
          deletions: 64,
          commentCount: 4,
        }),
        pr({
          repo: 'acme/widgets',
          number: 402,
          title: 'Virtualise the long tables on the reports page',
          author: priya,
          updated: 1 * DAY + 2 * HOUR,
          reviewers: [
            { kind: 'user', user: octocat, state: 'COMMENTED' },
            { kind: 'user', user: copilot, state: 'COMMENTED' },
          ],
          ci: ci({ passed: 6, pending: ['e2e (chromium)'] }),
          additions: 512,
          deletions: 230,
          commentCount: 7,
          labels: [{ name: 'performance', color: 'fbca04' }],
        }),
      ];
    default:
      return [];
  }
}

/** An open, review-required PR updated `updated` ms ago in `owner/name`, with whatever the case at hand overrides. */
function pr(fields: Omit<Partial<InboxFixtureRow>, 'repo'> & { repo: string; number: number; title: string; author: UserRef; updated: number }): InboxFixtureRow {
  const { repo, number, updated, ...overrides } = fields;
  const [owner = '', name = ''] = repo.split('/');
  return {
    id: `PR_${owner}_${name}_${number}`,
    repo: { owner, name },
    number,
    url: `https://github.com/${repo}/pull/${number}`,
    state: 'OPEN',
    isDraft: false,
    createdAt: new Date(NOW - updated - 3 * DAY).toISOString(),
    updatedAt: new Date(NOW - updated).toISOString(),
    mergedAt: null,
    headRefName: `${fields.author.login}/${fields.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`,
    baseRefName: 'main',
    reviewDecision: 'REVIEW_REQUIRED',
    reviewers: [],
    ci: ci({}),
    mergeStatus: 'BLOCKED',
    additions: 0,
    deletions: 0,
    changedFiles: 6,
    labels: [],
    commentCount: 0,
    unread: false,
    isInMergeQueue: false,
    autoMerge: null,
    nativeStack: null,
    ...overrides,
  };
}

/** The checks where `passed` succeeded (the first ones named build, lint, …) and the named ones failed, are still running, or were skipped. */
function ci({ passed = 0, failed = [], pending = [], skipped = [] }: { passed?: number; failed?: string[]; pending?: string[]; skipped?: string[] }): CiSummary {
  const counts = { success: passed, failure: failed.length, pending: pending.length, other: skipped.length };
  const state: CheckState = counts.failure > 0 ? 'FAILURE' : counts.pending > 0 ? 'PENDING' : counts.success > 0 ? 'SUCCESS' : 'NONE';
  const succeeded = ['build', 'lint', 'typecheck', 'unit (node 22)', 'integration (postgres-15)', 'e2e (chromium)', 'e2e (webkit)', 'codeql', 'storybook', 'bundle-size', 'docs', 'licenses']
    .filter((name) => !failed.includes(name) && !pending.includes(name) && !skipped.includes(name))
    .slice(0, passed);
  const checks = [
    ...succeeded.map((name) => [name, 'SUCCESS'] as const),
    ...failed.map((name) => [name, 'FAILURE'] as const),
    ...pending.map((name) => [name, 'PENDING'] as const),
    ...skipped.map((name) => [name, 'SKIPPED'] as const),
  ].map(([name, checkState]): CheckRunSummary => ({ name, state: checkState, url: null, description: null, group: 'GitHub Actions', startedAt: null, completedAt: null, runId: null }));
  return { state, checks, counts };
}
