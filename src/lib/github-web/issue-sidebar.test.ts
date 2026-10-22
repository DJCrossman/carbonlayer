import { afterEach, describe, expect, it, vi } from 'vitest';
import { assigneesMenu, labelsMenuIn } from './issue-sidebar';

afterEach(() => vi.unstubAllGlobals());

const pull = { repoPath: '/o/r', number: 1 };

describe("GitHub's sidebar menus", () => {
  it("reads the labels menu's form, its own token and every label, applied when GitHub's row or checkbox says so", () => {
    expect(labelsMenuIn(LABELS_MENU, pull)).toEqual({
      action: '/o/r/issues/1/labels',
      token: 'labels-token',
      labels: [
        { id: '11', name: 'area/api', color: '0e8a16', description: null, applied: true },
        { id: '12', name: 'bug', color: 'd73a4a', description: null, applied: false },
        { id: '13', name: 'needs-qa', color: 'fbca04', description: null, applied: true },
      ],
    });
  });

  it('refuses a labels menu without the form that sets the labels, naming the menu', () => {
    const onlyTheNewLabelForm = LABELS_MENU.slice(0, LABELS_MENU.indexOf('<form method="post" action="/o/r/issues/1/labels"'));
    expect(() => labelsMenuIn(onlyTheNewLabelForm, pull)).toThrow('/o/r/issues/1/show_partial (labels_menu_content) did not match: no form posts to /o/r/issues/1/labels');
  });

  it("reads whom the assignees menu offers as GitHub's JSON has them, and refuses an answer of another shape, naming the menu", async () => {
    const users = [{ id: 7, login: 'mona', name: 'Mona Lisa', avatar: 'https://avatars.githubusercontent.com/u/7?v=4', selected: true, class: '' }];
    const fetch = vi.fn(async (_path: string, _init: RequestInit) => Response.json({ users }));
    vi.stubGlobal('fetch', fetch);
    expect(await assigneesMenu(pull)).toEqual([{ id: 7, login: 'mona', name: 'Mona Lisa', avatar: 'https://avatars.githubusercontent.com/u/7?v=4', selected: true }]);
    expect(fetch).toHaveBeenCalledWith(
      '/o/r/issues/1/show_partial?partial=issues%2Fsidebar%2Fassignees_menu_content',
      expect.objectContaining({ headers: expect.objectContaining({ Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' }) }),
    );
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ users: [{ login: 'mona' }] })));
    await expect(assigneesMenu(pull)).rejects.toThrow(/^\/o\/r\/issues\/1\/show_partial \(assignees_menu_content\) did not match: [\s\S]*users\[0\]\.id/);
  });
});

/** GitHub's labels menu as its partial answers it: the form that creates a label, then the one that sets the PR's. */
const LABELS_MENU = `<div class="select-menu-list">
  <form method="post" action="/o/r/labels"><input type="hidden" name="authenticity_token" value="new-label-token"><input name="label[name]"></form>
  <form method="post" action="/o/r/issues/1/labels">
    <input type="hidden" name="_method" value="put"><input type="hidden" name="authenticity_token" value="labels-token">
    <input type="hidden" name="issue[labels][]" value="">
    <div class="js-filterable-issue-labels">
      ${[
        ['11', 'area/api', '0e8a16', 'aria-checked="true"', ''],
        ['12', 'bug', 'd73a4a', 'aria-checked="false"', ''],
        ['13', 'needs-qa', 'fbca04', 'aria-checked="false"', 'checked'],
      ]
        .map(
          ([id, name, color, ariaChecked, checked]) => `<label class="select-menu-item label-select-menu-item text-normal js-filterable-label" role="menuitemcheckbox" ${ariaChecked} tabindex="0" data-prio-filter-value="${name}">
        <svg class="octicon"></svg>
        <div class="select-menu-item-text">
          <input hidden="" type="checkbox" data-label-name="${name}" value="${id}" name="issue[labels][]" ${checked}>
          <div class="float-left color mr-2 js-label-color" label-color="${color}" style="margin-top: 2px; background-color: #${color}"></div>
          <div><svg class="octicon"></svg><div data-name="${id}" class="css-truncate js-label-id"><span class="name js-label-name-html">${name}</span></div></div>
        </div>
      </label>`,
        )
        .join('\n')}
    </div>
  </form>
</div>`;
