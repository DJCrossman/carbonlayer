import { describe, expect, it } from 'vitest';
import { mergeState } from './merge-box';

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

  it('assumes every merge method and asks the user-state condition when the actions are missing', () => {
    const state = mergeState({ mergeRequirements: { conditions: [{ type: 'PULL_REQUEST_USER_STATE', result: 'PASSED' }] } }, open);
    expect(state).toMatchObject({ allowedMergeMethods: ['MERGE', 'SQUASH', 'REBASE'], viewerCanMerge: true, viewerCanEnableAutoMerge: false });
    expect(mergeState({}, { isDraft: false, isOpen: false }).viewerCanMerge).toBe(false);
  });
});
