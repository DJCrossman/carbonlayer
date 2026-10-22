// The labels and assignees menus of GitHub's sidebar on a PR's conversation page, which sit on the issue path of the PR's
// number, and the classic forms that set them (docs/research/github-web-mutations.md, "Labels and assignees"; read from
// GitHub's page on 2026-10-22).

import { z } from 'zod/mini';
import type { LabelCandidate } from '../model';
import { readAnswer, request } from './session';

/**
 * GitHub's labels menu for a PR: every label of the repository, in the menu's order, whether each is on the PR, and the
 * form that sets the PR's labels, with that form's own token.
 */
export async function labelsMenu(pull: IssuePath): Promise<LabelsMenu> {
  const path = `${pull.repoPath}/issues/${pull.number}/show_partial?${new URLSearchParams({ partial: 'issues/sidebar/labels_menu_content' })}`;
  return labelsMenuIn(await (await request(path, 'text/html', { xhr: true })).text(), pull);
}

/**
 * The people GitHub's assignees menu for a PR offers, in its order: each with the numeric id its form sends, and whether
 * they are assigned (`selected`). Throws, naming the menu, for an answer of another shape.
 */
export async function assigneesMenu(pull: IssuePath): Promise<z.infer<typeof assigneesMenuAnswer>['users']> {
  const path = `${pull.repoPath}/issues/${pull.number}/show_partial?${new URLSearchParams({ partial: 'issues/sidebar/assignees_menu_content' })}`;
  const answer: unknown = await (await request(path, 'application/json')).json();
  return readAnswer(`${pull.repoPath}/issues/${pull.number}/show_partial (assignees_menu_content)`, assigneesMenuAnswer, answer).users;
}

/**
 * The labels menu's HTML, read. Its form is the one posting to the PR's `/issues/{n}/labels` (the menu's other form, which
 * creates a label, never counts), and its token is that form's `authenticity_token`. Each label is a
 * `.js-filterable-label` row in the form's `.js-filterable-issue-labels`: its id is the row's checkbox's value, its name the
 * checkbox's `data-label-name`, its colour the `label-color` of its `.js-label-color`, its description a `.description`
 * should the row have one, and it is on the PR when the row is `aria-checked="true"` or its checkbox `checked`. Throws,
 * naming the menu, when the form, its token, its list or a row's id or name is missing: GitHub changed the menu.
 */
export function labelsMenuIn(html: string, pull: IssuePath): LabelsMenu {
  const endpoint = `${pull.repoPath}/issues/${pull.number}/show_partial (labels_menu_content)`;
  const action = `${pull.repoPath}/issues/${pull.number}/labels`;
  const page = new DOMParser().parseFromString(html, 'text/html');
  const form = [...page.querySelectorAll('form')].find(
    (candidate) =>
      candidate.getAttribute('method')?.toLowerCase() === 'post' && new URL(candidate.getAttribute('action') ?? '', 'https://github.com').pathname.toLowerCase() === action.toLowerCase(),
  );
  if (!form) throw new Error(`${endpoint} did not match: no form posts to ${action}`);
  const token = form.querySelector('input[name="authenticity_token"]')?.getAttribute('value');
  if (!token) throw new Error(`${endpoint} did not match: its form carries no authenticity_token`);
  const list = form.querySelector('.js-filterable-issue-labels');
  if (!list) throw new Error(`${endpoint} did not match: its form lists no labels (.js-filterable-issue-labels)`);
  const labels = [...list.querySelectorAll('.js-filterable-label')].map((row) => {
    const box = row.querySelector('input[type="checkbox"][name="issue[labels][]"]');
    const id = box?.getAttribute('value');
    const name = box?.getAttribute('data-label-name');
    if (!box || !id || !name) throw new Error(`${endpoint} did not match: a label's row has no checkbox with its id and data-label-name`);
    return {
      id,
      name,
      color: row.querySelector('.js-label-color')?.getAttribute('label-color') ?? '',
      description: row.querySelector('.description')?.textContent?.trim() || null,
      applied: row.getAttribute('aria-checked') === 'true' || box.hasAttribute('checked'),
    };
  });
  return { action: form.getAttribute('action') ?? action, token, labels };
}

/** GitHub's assignees menu, asked for as JSON (the fields read here). */
const assigneesMenuAnswer = z.object({
  users: z.array(z.object({ id: z.number(), login: z.string(), name: z.nullish(z.string()), avatar: z.string(), selected: z.boolean() })),
});

/** Where a PR's issue lives: its repository's `/{owner}/{repo}` and its number. */
interface IssuePath {
  repoPath: string;
  number: number;
}

interface LabelsMenu {
  /** Where the form posts, as GitHub wrote it. */
  action: string;
  token: string;
  labels: Array<LabelCandidate & { applied: boolean }>;
}
