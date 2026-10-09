// Normalised domain model shared by the background (producer) and the UIs (consumers).
// Nothing here is GitHub-API-shaped; the background maps GraphQL/REST responses into these.

export interface RepoRef {
  owner: string;
  name: string;
}

export interface UserRef {
  login: string;
  avatarUrl: string;
  url: string;
}

export type PrState = 'OPEN' | 'MERGED' | 'CLOSED';

/** GitHub's reviewDecision, with NONE when no review is required and none given. */
export type ReviewDecision = 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | 'NONE';

export type CheckState = 'SUCCESS' | 'FAILURE' | 'PENDING' | 'SKIPPED' | 'NEUTRAL' | 'CANCELLED' | 'NONE';

export interface CheckRunSummary {
  name: string;
  state: CheckState;
  url: string | null;
  description: string | null;
  /** Workflow / app name when known (e.g. "GitHub Actions"), used for grouping. */
  group: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface CiSummary {
  state: CheckState;
  checks: CheckRunSummary[];
  counts: { success: number; failure: number; pending: number; other: number };
}

/** GitHub's mergeStateStatus plus DRAFT so the UI has one field to switch on. */
export type MergeStatus =
  | 'CLEAN'
  | 'HAS_HOOKS'
  | 'UNSTABLE'
  | 'BLOCKED'
  | 'BEHIND'
  | 'DIRTY'
  | 'DRAFT'
  | 'UNKNOWN';

export interface ReviewerSummary {
  user: UserRef;
  /** Latest opinionated review state from this reviewer, or PENDING when only requested. */
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'PENDING' | 'DISMISSED';
}

export interface LabelSummary {
  name: string;
  color: string;
}

/** One row in the inbox and one entry in a stack. */
export interface PrSummary {
  id: string;
  repo: RepoRef;
  number: number;
  title: string;
  url: string;
  author: UserRef;
  state: PrState;
  isDraft: boolean;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  headRefName: string;
  baseRefName: string;
  reviewDecision: ReviewDecision;
  reviewers: ReviewerSummary[];
  ci: CiSummary;
  mergeStatus: MergeStatus;
  additions: number;
  deletions: number;
  changedFiles: number;
  labels: LabelSummary[];
  /** Comment + review-comment count, for the inbox row. */
  commentCount: number;
}

export interface Stack {
  /** Ordered from the PR closest to trunk (index 0) to the top of the stack. */
  entries: PrSummary[];
  /** Index of the PR being viewed in `entries`. */
  currentIndex: number;
  trunk: string;
}

export interface ReviewThreadComment {
  id: string;
  author: UserRef;
  bodyHtml: string;
  body: string;
  createdAt: string;
  url: string;
}

export interface ReviewThread {
  id: string;
  path: string;
  /** Line in the new file (RIGHT) or old file (LEFT); null when outdated beyond the current diff. */
  line: number | null;
  startLine: number | null;
  side: 'LEFT' | 'RIGHT';
  isResolved: boolean;
  isOutdated: boolean;
  diffHunk: string;
  comments: ReviewThreadComment[];
}

export type TimelineItem =
  | { kind: 'comment'; id: string; author: UserRef; bodyHtml: string; createdAt: string; url: string }
  | {
      kind: 'review';
      id: string;
      author: UserRef;
      state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING';
      bodyHtml: string;
      createdAt: string;
      url: string;
      /** Thread ids opened by this review, so the UI can link review → threads. */
      threadIds: string[];
    }
  | { kind: 'commit'; id: string; oid: string; abbreviatedOid: string; messageHeadline: string; author: UserRef | null; committedAt: string; url: string }
  | { kind: 'force-push'; id: string; actor: UserRef | null; createdAt: string; beforeOid: string; afterOid: string }
  | { kind: 'review-requested'; id: string; actor: UserRef | null; requested: string; createdAt: string }
  | { kind: 'ready-for-review' | 'converted-to-draft' | 'merged' | 'closed' | 'reopened'; id: string; actor: UserRef | null; createdAt: string };

export interface ChangedFile {
  path: string;
  previousPath: string | null;
  status: 'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'changed' | 'unchanged';
  additions: number;
  deletions: number;
  /** Unified diff hunks for this file (GitHub REST `patch`), null for binary / too large. */
  patch: string | null;
  viewerViewedState: 'VIEWED' | 'UNVIEWED' | 'DISMISSED';
  blobUrl: string;
}

export interface PrDetail extends PrSummary {
  bodyHtml: string;
  body: string;
  headOid: string;
  baseOid: string;
  assignees: UserRef[];
  viewerCanUpdate: boolean;
  viewerDidAuthor: boolean;
  viewerLogin: string;
  timeline: TimelineItem[];
  threads: ReviewThread[];
  files: ChangedFile[];
  stack: Stack;
  defaultMergeMethod: 'MERGE' | 'SQUASH' | 'REBASE';
  allowedMergeMethods: Array<'MERGE' | 'SQUASH' | 'REBASE'>;
  autoMergeEnabled: boolean;
}

export interface View {
  id: string;
  name: string;
  /** GitHub search query, e.g. "is:open is:pr review-requested:@me". `@me` is allowed. */
  query: string;
  limit?: number;
  collapsed?: boolean;
}

export interface ViewResult {
  view: View;
  prs: PrSummary[];
  totalCount: number;
  fetchedAt: string;
}
