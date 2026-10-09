// Inbox fixtures for the dev harness (`app.html?fixtures=1#/inbox`): every default view, covering each review, CI and
// merge state a row can show, native stack positions, unread rows, long titles, labels and team reviewers. The viewer is
// octocat. Ages are relative to page load so the harness always looks current. CI is a rollup without per-check
// detail, as GitHub's dashboard endpoints return it; the team-review rows also have no line counts and no merge state.
import type { CheckState, CiSummary, PrSummary, UserRef, ViewResult } from '../lib/model';
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

export const inboxFixtures: ViewResult[] = DEFAULT_VIEWS.map((view) => {
  const prs = prsFor(view.id);
  return { view, prs, totalCount: prs.length, fetchedAt: new Date(NOW).toISOString() };
});

function prsFor(viewId: string): PrSummary[] {
  switch (viewId) {
    case 'needs-review':
      return [
        pr({
          repo: 'acme/widgets',
          number: 412,
          title: 'Add keyboard navigation to the command palette',
          author: mona,
          updated: 25 * MINUTE,
          unread: true,
          reviewers: [{ kind: 'user', user: octocat, state: 'PENDING' }],
          ci: ci({ passed: 8, pending: ['e2e (chromium)', 'deploy-preview'] }),
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
          reviewers: [{ kind: 'user', user: octocat, state: 'PENDING' }, { kind: 'user', user: kenji, state: 'COMMENTED' }],
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
          reviewers: [{ kind: 'user', user: octocat, state: 'PENDING' }],
          ci: ci({ passed: 9, skipped: ['deploy-preview'] }),
          additions: 88,
          deletions: 141,
          commentCount: 2,
        }),
      ];
    case 'team-review':
      return [
        pr({
          repo: 'acme/platform',
          number: 1293,
          title: 'Bump the Terraform AWS provider to v6',
          author: kenji,
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
    case 'returned':
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
          mergeStatus: 'UNSTABLE',
          additions: 402,
          deletions: 20,
          changedFiles: 12,
          commentCount: 9,
          labels: [{ name: 'enhancement', color: 'a2eeef' }],
        }),
      ];
    case 'approved':
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
          reviewDecision: 'APPROVED',
          reviewers: [{ kind: 'user', user: mona, state: 'APPROVED' }],
          ci: ci({ passed: 8, pending: ['e2e (webkit)'] }),
          autoMerge: { method: 'SQUASH' },
          additions: 260,
          deletions: 12,
          commentCount: 2,
        }),
      ];
    case 'drafts':
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
          reviewDecision: 'NONE',
          ci: ci({ passed: 4, failed: ['e2e (chromium)'] }),
          mergeStatus: 'DRAFT',
          additions: 51,
          deletions: 30,
        }),
      ];
    case 'waiting-reviewers':
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
          ci: ci({ passed: 10 }),
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
          reviewers: [{ kind: 'user', user: jdoe, state: 'PENDING' }],
          ci: ci({ passed: 7, failed: ['unit (node 22)', 'integration (postgres-15)'] }),
          mergeStatus: 'UNSTABLE',
          additions: 130,
          deletions: 22,
        }),
      ];
    case 'recently-merged':
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
    default:
      return [];
  }
}

/** An open, review-required PR updated `updated` ms ago in `owner/name`, with whatever the case at hand overrides. */
function pr(fields: Omit<Partial<PrSummary>, 'repo'> & { repo: string; number: number; title: string; author: UserRef; updated: number }): PrSummary {
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

/** GitHub's CI rollup where `passed` checks succeeded and the named ones failed, are still running, or were skipped. */
function ci({ passed = 0, failed = [], pending = [], skipped = [] }: { passed?: number; failed?: string[]; pending?: string[]; skipped?: string[] }): CiSummary {
  const counts = { success: passed, failure: failed.length, pending: pending.length, other: skipped.length };
  const state: CheckState = counts.failure > 0 ? 'FAILURE' : counts.pending > 0 ? 'PENDING' : counts.success > 0 ? 'SUCCESS' : 'NONE';
  return { state, checks: [], counts };
}
