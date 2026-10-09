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

  it('derives the state from the requirements when GitHub does not name it, and drafts are DRAFT', () => {
    const conflict = { mergeRequirements: { state: 'UNMERGEABLE', conditions: [{ type: 'PULL_REQUEST_MERGE_CONFLICT_STATE', result: 'FAILED' }] } };
    expect(mergeState(conflict, open).mergeStatus).toBe('DIRTY');
    expect(mergeState({ mergeRequirements: { state: 'MERGEABLE', conditions: [] } }, open).mergeStatus).toBe('CLEAN');
    expect(mergeState({ pullRequest: { mergeStateStatus: 'CLEAN' } }, { isDraft: true, isOpen: true }).mergeStatus).toBe('DRAFT');
  });

  it('assumes every merge method and asks the user-state condition when the actions are missing', () => {
    const state = mergeState({ mergeRequirements: { conditions: [{ type: 'PULL_REQUEST_USER_STATE', result: 'PASSED' }] } }, open);
    expect(state).toMatchObject({ allowedMergeMethods: ['MERGE', 'SQUASH', 'REBASE'], viewerCanMerge: true, viewerCanEnableAutoMerge: false });
    expect(mergeState({}, { isDraft: false, isOpen: false }).viewerCanMerge).toBe(false);
  });
});
