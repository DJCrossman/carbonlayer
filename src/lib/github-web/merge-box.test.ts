import { describe, expect, it } from 'vitest';
import { mergeBoxAnswer, mergeState } from './merge-box';

describe('mergeState', () => {
  const open = { isDraft: false, isOpen: true };

  it("takes GitHub's merge state and the viewer's merge actions", () => {
    const state = mergeState(
      {
        pullRequest: {
          mergeStateStatus: 'BLOCKED',
          isInMergeQueue: false,
          autoMergeRequest: { mergeMethod: 'SQUASH' },
          viewerMergeActions: [
            {
              name: 'DIRECT_MERGE',
              isAllowable: true,
              mergeMethods: [
                { name: 'MERGE', allowableStatus: 'UNAVAILABLE' },
                { name: 'SQUASH', allowableStatus: 'ALLOWED', isDefault: true },
                { name: 'REBASE', allowableStatus: 'ALLOWED_WITH_BYPASS' },
              ],
            },
            { name: 'AUTO_MERGE', isAllowable: true },
          ],
        },
        mergeRequirements: { state: 'UNMERGEABLE', conditions: [] },
      },
      open,
    );
    expect(state).toMatchObject({
      mergeStatus: 'BLOCKED',
      allowedMergeMethods: ['SQUASH', 'REBASE'],
      defaultMergeMethod: 'SQUASH',
      viewerCanMerge: true,
      viewerCanEnableAutoMerge: true,
      autoMerge: { method: 'SQUASH' },
    });
  });

  it("offers auto-merge when GitHub's flag does, though its merge actions name none (as on GitHub today)", () => {
    const box = (viewerCanEnableAutoMerge: boolean) => ({
      pullRequest: {
        mergeStateStatus: 'BLOCKED',
        viewerCanEnableAutoMerge,
        viewerMergeActions: [{ name: 'DIRECT_MERGE', mergeMethods: [{ name: 'SQUASH', allowableStatus: 'ALLOWED', isDefault: true }] }],
      },
    });
    expect(mergeState(box(true), open).viewerCanEnableAutoMerge).toBe(true);
    expect(mergeState(box(false), open).viewerCanEnableAutoMerge).toBe(false);
    expect(mergeState(box(true), { isDraft: false, isOpen: false }).viewerCanEnableAutoMerge).toBe(false);
  });

  it('derives the state from the requirements when GitHub does not name it, and for drafts', () => {
    const conflict = { mergeRequirements: { state: 'UNMERGEABLE', conditions: [{ type: 'PULL_REQUEST_MERGE_CONFLICT_STATE', result: 'FAILED' }] } };
    expect(mergeState(conflict, open).mergeStatus).toBe('DIRTY');
    expect(mergeState({ mergeRequirements: { state: 'MERGEABLE', conditions: [] } }, open).mergeStatus).toBe('CLEAN');
    // A draft's box says DRAFT and fails the state condition; the other conditions still say how it would merge.
    const draft = { isDraft: true, isOpen: true };
    const draftBox = (conditions: Array<{ type: string; result: string }>) => ({ pullRequest: { mergeStateStatus: 'DRAFT' }, mergeRequirements: { state: 'UNMERGEABLE', conditions } });
    expect(mergeState(draftBox([{ type: 'PULL_REQUEST_STATE', result: 'FAILED' }, { type: 'PULL_REQUEST_MERGE_CONFLICT_STATE', result: 'FAILED' }]), draft).mergeStatus).toBe('DIRTY');
    expect(mergeState(draftBox([{ type: 'PULL_REQUEST_STATE', result: 'FAILED' }, { type: 'PULL_REQUEST_RULES', result: 'FAILED' }]), draft).mergeStatus).toBe('BLOCKED');
    expect(mergeState(draftBox([{ type: 'PULL_REQUEST_STATE', result: 'FAILED' }, { type: 'PULL_REQUEST_MERGE_CONFLICT_STATE', result: 'PASSED' }]), draft).mergeStatus).toBe('CLEAN');
    expect(mergeState({ pullRequest: { mergeStateStatus: 'DRAFT' } }, draft).mergeStatus).toBe('UNKNOWN');
  });

  describe("GitHub's section about a native stack's branches", () => {
    // The merge box of offstreetparking/core#8986 (signed in, 2026-10-15): three drafts above it, #8985 below, the
    // stack behind main. `entries` and `conditions` replace its own.
    const entry = (position: string, status: string, number: number) => ({ position, status, pull: { number } });
    const pr8986 = ({
      entries = [entry('AFTER', 'IRRELEVANT_DRAFT', 9147), entry('AFTER', 'IRRELEVANT_DRAFT', 9146), entry('AFTER', 'IRRELEVANT_DRAFT', 9145), entry('CURRENT', 'NEEDS_MERGE_STATE', 8986), entry('BEFORE', 'NEEDS_MERGE_STATE', 8985)],
      conditions = [{ type: 'PULL_REQUEST_USER_STATE', result: 'PASSED' }],
      isInMergeQueue = false,
    }: { entries?: Array<ReturnType<typeof entry>>; conditions?: Array<{ type: string; result: string; ruleRollups?: Array<{ ruleType: string; result: string }> }>; isInMergeQueue?: boolean } = {}) => ({
      pullRequest: { mergeStateStatus: 'BLOCKED', isInMergeQueue, anyStackBranchOutdated: true, stackedBaseRefName: 'main' },
      mergeRequirements: {
        state: 'UNMERGEABLE',
        conditions: [...conditions, { type: 'STACK', displayName: 'Stack', description: null, message: null, result: 'PASSED', stack: { id: 1, number: 12 }, isStacked: true, entries }],
      },
    });

    it('says a stack behind its base branch is out of date, which a viewer who may push can rebase', () => {
      expect(mergeState(mergeBoxAnswer.parse(pr8986()), open).stackSection).toEqual({ kind: 'rebase-optional', baseRefName: 'main', viewerCanRebase: true });
    });

    it('puts conflicts first, this branch before the stack, then a branch that must be rebased, and leaves out the PRs above it', () => {
      const kind = (entries: Array<ReturnType<typeof entry>>) => mergeState(pr8986({ entries }), open).stackSection?.kind;
      expect(kind([entry('CURRENT', 'MERGE_CONFLICTS', 8986), entry('BEFORE', 'MERGE_CONFLICTS', 8985)])).toBe('current-conflicts');
      expect(kind([entry('CURRENT', 'NEEDS_REBASE', 8986), entry('BEFORE', 'MERGE_CONFLICTS', 8985)])).toBe('conflicts');
      expect(kind([entry('CURRENT', 'NEEDS_MERGE_STATE', 8986), entry('BEFORE', 'NEEDS_REBASE', 8985)])).toBe('rebase-required');
      expect(kind([entry('AFTER', 'MERGE_CONFLICTS', 9145), entry('AFTER', 'NEEDS_REBASE', 9146), entry('CURRENT', 'NEEDS_MERGE_STATE', 8986)])).toBe('rebase-optional');
    });

    it('says nothing outside a stack, of a stack up to date, or of a closed PR', () => {
      const alone = { pullRequest: { anyStackBranchOutdated: true }, mergeRequirements: { conditions: [{ type: 'STACK', result: 'PASSED', isStacked: false, entries: [] }] } };
      expect(mergeState(alone, open).stackSection).toBeNull();
      expect(mergeState({ ...pr8986(), pullRequest: { anyStackBranchOutdated: false } }, open).stackSection).toBeNull();
      expect(mergeState(pr8986(), { isDraft: false, isOpen: false }).stackSection).toBeNull();
      expect(mergeState({}, open).stackSection).toBeNull();
    });

    it("offers GitHub's Rebase stack only to a viewer who may push, whom no authorization rule stops, outside the merge queue", () => {
      const canRebase = (box: ReturnType<typeof pr8986>) => mergeState(box, open).stackSection?.viewerCanRebase;
      const userState = { type: 'PULL_REQUEST_USER_STATE', result: 'PASSED' };
      expect(canRebase(pr8986({ conditions: [{ type: 'PULL_REQUEST_USER_STATE', result: 'FAILED' }] }))).toBe(false);
      expect(canRebase(pr8986({ conditions: [userState, { type: 'PULL_REQUEST_RULES', result: 'FAILED', ruleRollups: [{ ruleType: 'AUTHORIZATION', result: 'FAILED' }] }] }))).toBe(false);
      expect(canRebase(pr8986({ conditions: [userState, { type: 'PULL_REQUEST_RULES', result: 'FAILED', ruleRollups: [{ ruleType: 'PULL_REQUEST', result: 'FAILED' }] }] }))).toBe(true);
      expect(canRebase(pr8986({ isInMergeQueue: true }))).toBe(false);
    });
  });

  describe('the PRs of a native stack auto-merge covers', () => {
    // The merge box of offstreetparking/core#9265, the top of a four-PR stack, signed in with auto-merge off (2026-10-21):
    // each STACK entry's PR says `isInAutoMergeRange: false`. `marks` replaces what an entry's PR says, by number; null
    // leaves the key out.
    const pr9265 = (marks: Record<number, boolean | null> = {}) =>
      mergeBoxAnswer.parse({
        pullRequest: { mergeStateStatus: 'BLOCKED', isInMergeQueue: false, viewerCanEnableAutoMerge: true, autoMergeRequest: null },
        mergeRequirements: {
          state: 'UNMERGEABLE',
          conditions: [
            { type: 'PULL_REQUEST_RULES', result: 'FAILED', message: 'At least 1 approving review is required by reviewers with write access.' },
            {
              type: 'STACK',
              result: 'PASSED',
              isStacked: true,
              entries: [9265, 9264, 9263, 9262].map((number, index) => {
                const mark = marks[number] ?? false;
                return {
                  pull: {
                    number,
                    state: 'OPEN',
                    headOid: String(number).padStart(40, '0'),
                    headBranch: `stack/${number}`,
                    title: `Part ${4 - index}`,
                    url: `/offstreetparking/core/pull/${number}`,
                    ...(marks[number] !== null && { isInAutoMergeRange: mark }),
                    isUnstackable: false,
                  },
                  position: index === 0 ? 'CURRENT' : 'BEFORE',
                  status: 'NEEDS_MERGE_STATE',
                  failedSubConditions: [],
                };
              }),
            },
          ],
        },
      });

    it('names none while auto-merge is off', () => {
      expect(mergeState(pr9265(), open).autoMergeRange).toEqual([]);
    });

    it('names each entry GitHub marks, this PR among them, and leaves out one marked false or saying nothing', () => {
      expect(mergeState(pr9265({ 9265: true, 9264: true, 9263: false, 9262: null }), open).autoMergeRange).toEqual([9265, 9264]);
    });

    it('names none outside a stack, and leaves out an entry whose PR GitHub did not send', () => {
      expect(mergeState({}, open).autoMergeRange).toEqual([]);
      const withoutPull = { mergeRequirements: { conditions: [{ type: 'STACK', result: 'PASSED', isStacked: true, entries: [{ position: 'CURRENT', status: 'NEEDS_MERGE_STATE' }] }] } };
      expect(mergeState(mergeBoxAnswer.parse(withoutPull), open).autoMergeRange).toEqual([]);
    });
  });

  it('assumes every merge method and asks the user-state condition when the actions are missing', () => {
    const state = mergeState({ mergeRequirements: { conditions: [{ type: 'PULL_REQUEST_USER_STATE', result: 'PASSED' }] } }, open);
    expect(state).toMatchObject({ allowedMergeMethods: ['MERGE', 'SQUASH', 'REBASE'], viewerCanMerge: true, viewerCanEnableAutoMerge: false });
    expect(mergeState({}, { isDraft: false, isOpen: false }).viewerCanMerge).toBe(false);
  });
});
