// Graphite's PR-inbox sections as inbox views. Graphite shares one section's filter as
// `https://app.graphite.com/?new-section=<…>` and every section (name, filter, repositories) as `?shared-sections=<…>`,
// both `btoa(encodeURIComponent(JSON))`; its signed-in inbox page holds every section in React's state, which
// `inboxSnapshotOf` copies out. A filter ORs its groups, ANDs a group's rules and ORs a rule's conditions (one kind per
// rule), and `isNegated` negates a whole rule; the inbox page holds the same filter as an OR / AND / NOT tree. A section
// becomes one view: GitHub's search ORs parenthesised groups, `is:pr ((a b) OR (c))`, up to five operators a query.
// See docs/research/graphite-sections.md.

import { z } from 'zod';
import type { RepoRef, View } from './model';
import { repositoryScope } from './views';

/**
 * The views that pasted Graphite section links (one per line), their decoded JSON, or the sections copied from
 * Graphite's inbox page describe: one per section, with notes on what GitHub's search only approximates or cannot
 * express. Also how many sections there were, notes on any that could not be imported, and the inbox's repositories,
 * for the inbox's own choice, when a section searches those. `viewerLogin`, Graphite's signed-in user (the inbox page's
 * copy names its own), is searched as `@me`. Throws an Error saying what is wrong with junk.
 */
export function importGraphiteSections(
  input: string | GraphiteInboxSnapshot,
  options: { viewerLogin?: string } = {},
): { views: Array<{ view: View; notes: string[] }>; notes: string[]; sectionCount: number; inboxRepos: RepoRef[] | null } {
  const sections = typeof input === 'string' ? readSections(input) : sectionsIn(input, "Graphite's inbox");
  const viewer = (options.viewerLogin ?? (typeof input === 'string' ? undefined : input.viewerLogin))?.toLowerCase() || null;
  const views: Array<{ view: View; notes: string[] }> = [];
  const notes: string[] = [];
  for (const section of sections) {
    const name = section.name?.trim() || 'Imported section';
    if (!section.filter) {
      notes.push(...section.notes.map((note) => `${name}: ${note}`));
      continue;
    }
    // Views keep the filter with the viewer as @me, as the section editor offers it, and the section's own repositories.
    const filter: GraphiteFilter = {
      groups: section.filter.groups.map((group) => ({
        rules: group.rules.map((rule) => ({
          ...rule,
          conditions: rule.conditions.map((condition) =>
            typeof condition.username === 'string' && (condition.username === '<REPLACE_USERNAME>' || condition.username.toLowerCase() === viewer)
              ? { ...condition, username: '@me' }
              : condition,
          ),
        })),
      })),
    };
    const repos = section.repos.map((repo) => ({ owner: repo.owner, name: repo.name }));
    const search = searchForFilter(filter, repos);
    if (search.query === null) {
      const leftOut = "GitHub's search can express none of its filter groups; that section was left out.";
      notes.push(...[...section.notes, ...search.notes, leftOut].map((note) => `${name}: ${note}`));
      continue;
    }
    // One search holds at most five AND / OR / NOT operators.
    if (search.operators <= 5 || search.groupsKept.length < 2) {
      views.push({ view: { id: crypto.randomUUID(), name, query: search.query, filter, ...(repos.length > 0 && { repos }) }, notes: [...new Set([...section.notes, ...search.notes])] });
      continue;
    }
    const split = `Graphite matches any of its ${search.groupsKept.length} filter groups, more than one GitHub search can OR; each group is a view of its own.`;
    for (const [index, kept] of search.groupsKept.flatMap((groupIndex) => filter.groups[groupIndex] ?? []).entries()) {
      const groupFilter = { groups: [kept] };
      const group = searchForFilter(groupFilter, repos);
      // The whole filter's search kept the group, so it searches on its own.
      if (group.query === null) continue;
      views.push({
        view: { id: crypto.randomUUID(), name: `${name} (${index + 1})`, query: group.query, filter: groupFilter, ...(repos.length > 0 && { repos }) },
        notes: [...new Set([...section.notes, split, ...group.notes])],
      });
    }
  }
  // Only a copy of the inbox page names the inbox's repositories, which sectionsIn has read by now.
  const defaultRepos = typeof input !== 'string' && sections.some((section) => section.usesInboxRepos) ? graphiteRepos.parse(input.defaultRepos) : [];
  const inboxRepos = defaultRepos.length > 0 ? defaultRepos.map((repo) => ({ owner: repo.owner, name: repo.name })) : null;
  return { views, notes, sectionCount: sections.length, inboxRepos };
}

/**
 * The GitHub search selecting what a Graphite filter selects in `repos` (none: wherever the search runs), with notes on
 * what it approximates or leaves out, how many AND / OR / NOT operators it takes (GitHub allows five) and which of the
 * filter's groups it still needs. `query` is null when GitHub's search can express none of the groups. `viewer`, the
 * signed-in user's login, is searched as `@me`, as are Graphite's `<REPLACE_USERNAME>` and a stored `@me`.
 *
 * Each group comes to one or more alternatives (see translateGroup); GitHub's search ORs them as `is:pr <terms every
 * alternative has> ((a1) OR (a2))`, the outer parentheses keeping an inbox scope written in front applying to all.
 */
export function searchForFilter(
  filter: GraphiteFilter,
  repos: Array<{ owner: string; name: string }>,
  viewer: string | null = null,
): { query: string | null; notes: string[]; operators: number; groupsKept: number[] } {
  const notes: string[] = [];
  // A filter with no groups matches every pull request.
  const alternatives = (filter.groups.length > 0 ? filter.groups : [{ rules: [] }]).flatMap((group, index) => {
    const translated = translateGroup(group.rules, viewer?.toLowerCase() ?? null);
    notes.push(...translated.notes);
    return translated.alternatives.map((terms) => ({ terms, group: index }));
  });
  // An OR gains nothing from an alternative twice, or from one with every term of another: it only narrows that one.
  const kept = alternatives.filter(
    ({ terms }, index) =>
      !alternatives.some(
        (other, otherIndex) => otherIndex !== index && other.terms.every((term) => terms.includes(term)) && (other.terms.length < terms.length || otherIndex < index),
      ),
  );
  const [first] = kept;
  if (!first) return { query: null, notes: [...new Set(notes)], operators: 0, groupsKept: [] };
  const common = first.terms.filter((term) => kept.every(({ terms }) => terms.includes(term)));
  const ored = kept.map(({ terms }) => `(${terms.filter((term) => !common.includes(term)).join(' ')})`);
  const query = [
    ...new Set(['is:pr', ...(repos.length > 0 ? [repositoryScope(repos)] : []), ...common, ...(kept.length > 1 ? [`(${ored.join(' OR ')})`] : []), 'sort:updated-desc']),
  ].join(' ');
  // Quoted text holds no operators.
  const operators = query.replace(/"[^"]*"/g, '""').match(/(?<![^\s(])(?:AND|OR|NOT)(?![^\s)])/g)?.length ?? 0;
  return { query, notes: [...new Set(notes)], operators, groupsKept: [...new Set(kept.map(({ group }) => group))] };
}

/**
 * The sections and repositories Graphite's inbox page holds, read from React's state behind `element` (any element of
 * the inbox, such as a section in its sidebar), or null when no component above it holds them. The page fetches no
 * section list one could request again: the sections arrive through the app's own sync and live in the `snapshot` prop
 * of a component some 40 levels above the sidebar. Runs in Graphite's page (entrypoints/graphite-sections.content.ts),
 * and copies plain data, which postMessage can carry whatever library holds the state.
 */
export function inboxSnapshotOf(element: object): GraphiteInboxSnapshot | null {
  // React keeps each element's fiber under a key with a per-page random suffix.
  let fiber: unknown = Object.entries(element).find(([name]) => name.startsWith('__reactFiber$'))?.[1];
  let inbox: InboxState | null = null;
  let viewerLogin: string | undefined;
  for (let depth = 0; ; depth += 1) {
    const step = fiberSchema.safeParse(fiber);
    if (!step.success) break;
    const props = step.data.memoizedProps;
    inbox ??= inboxStateProps.safeParse(props).data?.snapshot ?? null;
    // Not an element of the inbox.
    if (!inbox && depth >= 100) return null;
    // Further up, Graphite's signed-in-user context provides { user: { githubLogin, github: { login } } }.
    const user = signedInUserProps.safeParse(props).data?.value.user;
    const login = user?.githubLogin ?? user?.github?.login;
    if (inbox && login) {
      viewerLogin = login;
      break;
    }
    fiber = step.data.return;
  }
  if (!inbox) return null;
  // Plain data, which postMessage can carry whatever library holds the state.
  const copied: unknown = JSON.parse(
    JSON.stringify({
      sections: inbox.sections.map((section) => ({
        name: section?.name,
        filter: section?.filter,
        repos: section?.repos,
        usesDefaultRepos: section?.usesDefaultRepos,
        includeInTotalCount: section?.includeInTotalCount,
      })),
      // The inbox's "N repos selected", without the ones Graphite can no longer reach.
      defaultRepos: inbox.syncedRepos.filter((repo) => repo && !repo.isInvalid).map((repo) => ({ owner: repo?.owner, name: repo?.name })),
      viewerLogin,
    }),
  );
  const read = graphiteInboxSnapshot.safeParse(copied);
  if (!read.success) throw new Error(`Graphite's inbox did not match: ${z.prettifyError(read.error)}`);
  return read.data;
}

/**
 * What Graphite's inbox page holds, the way `inboxSnapshotOf` copies it out of the page and the copy travels to the
 * import (entrypoints/graphite.content.ts, background.ts): every section named, the rest the way Graphite holds it,
 * which the import reads (sectionsIn).
 */
export const graphiteInboxSnapshot = z.object({
  /** `filter` is the OR / AND / NOT tree; `usesDefaultRepos` sections search `defaultRepos` instead of `repos`. */
  sections: z.array(
    z.object({
      name: z.string(),
      filter: z.unknown().optional(),
      repos: z.unknown().optional(),
      usesDefaultRepos: z.unknown().optional(),
      includeInTotalCount: z.unknown().optional(),
    }),
  ),
  /** The repositories the inbox covers (its "N repos selected"). */
  defaultRepos: z.array(z.unknown()),
  /** Who is signed in to Graphite, when the page said. */
  viewerLogin: z.string().optional(),
});

export type GraphiteInboxSnapshot = z.infer<typeof graphiteInboxSnapshot>;

/** A section as read; only `shared-sections` links and the inbox page carry a name and repositories. */
interface GraphiteSection {
  name: string | null;
  /** Null for a section copied from the inbox page whose filter could not be read; its notes say so. */
  filter: GraphiteFilter | null;
  repos: Array<{ owner: string; name: string }>;
  /** Whether the section searches the inbox's repositories, which the inbox's scope stands for. */
  usesInboxRepos: boolean;
  /** What reading the section left out or changed, before its filter is translated. */
  notes: string[];
}

/**
 * One rule of a section's filter: never without conditions, every condition of one kind and with the value that kind
 * needs (RULE_KINDS' `field`: a number of hours, else a string).
 */
const graphiteRuleSchema = z
  .object({ isNegated: z.boolean(), conditions: z.array(z.looseObject({ kind: z.string() })).min(1) })
  .refine(
    ({ conditions }) =>
      conditions.every((condition) => {
        const field = Object.hasOwn(RULE_KINDS, condition.kind) ? RULE_KINDS[condition.kind]?.field : undefined;
        return condition.kind === conditions[0]?.kind && (!field || typeof condition[field] === (field === 'hours' ? 'number' : 'string'));
      }),
    'Every condition of a rule is of one kind, with the value that kind needs',
  );

export type GraphiteRule = z.infer<typeof graphiteRuleSchema>;

/**
 * A section's filter the way Graphite's share links write it (its inbox page's tree converts to it); views keep it as
 * is.
 */
export const graphiteFilterSchema = z.object({ groups: z.array(z.object({ rules: z.array(graphiteRuleSchema) })) });

export type GraphiteFilter = z.infer<typeof graphiteFilterSchema>;

/** The sections pasted: one or more Graphite links, whitespace-separated, or the JSON one of them carries. */
function readSections(input: string): GraphiteSection[] {
  const text = input.trim();
  if (!text) throw new Error('Paste a Graphite section link (https://app.graphite.com/?new-section=… or ?shared-sections=…).');
  if (text.startsWith('{') || text.startsWith('[')) {
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error('That looks like JSON, but it does not parse.');
    }
    return sectionsIn(payload, 'That JSON');
  }
  const links = text.split(/\s+/);
  return links.flatMap((link, index) => {
    const which = links.length > 1 ? `Link ${index + 1}` : 'That link';
    let encoded: string | null = null;
    try {
      const params = new URL(link).searchParams;
      encoded = params.get('new-section') ?? params.get('shared-sections');
    } catch {
      // Not a URL; reported below.
    }
    if (!encoded) throw new Error(`${which} is not a Graphite section link (https://app.graphite.com/?new-section=… or ?shared-sections=…).`);
    let payload: unknown;
    try {
      // Standard base64: a `+` that was not form-encoded reads back as a space, which atob would drop.
      payload = JSON.parse(decodeURIComponent(atob(encoded.replace(/ /g, '+'))));
    } catch {
      throw new Error(`${which} does not decode; was it copied in full?`);
    }
    return sectionsIn(payload, which);
  });
}

/**
 * The alternatives (each a list of GitHub search terms, ANDed) one group of a filter comes to: its rules ANDed, a rule
 * that only several alternatives express spreading over the group, and alternatives that contradict themselves left
 * out. None when the group needs something GitHub cannot search for, or can match nothing. Also notes on what the
 * alternatives approximate or leave out. `viewer` is the signed-in user's login in lower case.
 */
function translateGroup(rules: GraphiteRule[], viewer: string | null): { alternatives: string[][]; notes: string[] } {
  const notes: string[] = [];
  // The PR-status rules together allow one set of GitHub's states (see PR_STATES), searched where the first of them was.
  let states = 0b1111;
  const statusRules: string[] = [];
  for (const { isNegated, conditions } of rules) {
    if (conditions[0]?.kind !== 'CONSOLIDATED_PR_STATUS_IS') continue;
    const statuses = conditions.map((condition) => String(condition.status));
    const quoted = `“PR status ${isNegated ? 'is not' : 'is'} ${statuses.join(' or ')}”`;
    // Merging (Graphite's merge queue) has no search qualifier: only Open, which holds it, selects it, and excluding it
    // excludes nothing.
    const unsearchable = statuses.filter((status) => !Object.hasOwn(PR_STATES, status) && !(status === 'MERGING' && (isNegated || statuses.includes('OPEN'))));
    if (unsearchable.length > 0) {
      if (!isNegated) return { alternatives: [], notes: [...notes, `${quoted} has no GitHub search equivalent; that filter group was left out.`] };
      notes.push(`${quoted}: ${unsearchable.join(', ')} has no GitHub search equivalent and was left out, so more pull requests show.`);
    }
    let allowed = 0;
    for (const status of statuses) allowed |= PR_STATES[status] ?? 0;
    states &= isNegated ? 0b1111 & ~allowed : allowed;
    statusRules.push(quoted);
  }
  // No pull request has two states, in Graphite as on GitHub.
  if (states === 0) return { alternatives: [], notes };
  const stateTerms = STATE_TERMS[states];
  const wording = statusRules.join(' and ');
  if (!stateTerms) {
    notes.push(statusRules.length > 1 ? `${wording} have no GitHub search equivalent together; those rules were left out.` : `${wording} has no GitHub search equivalent; that rule was left out.`);
  } else if (states === 0b0111) {
    notes.push(`${wording} is searched as is:open, which leaves out merged pull requests.`);
  }

  let alternatives: string[][] = [[]];
  let statusSearched = false;
  for (const rule of rules) {
    let ruleAlternatives: string[][];
    if (rule.conditions[0]?.kind === 'CONSOLIDATED_PR_STATUS_IS') {
      if (statusSearched) continue;
      statusSearched = true;
      ruleAlternatives = [stateTerms ?? []];
    } else {
      const translated = translateRule(rule, viewer, states === PR_STATES.MERGED);
      notes.push(...translated.notes);
      if (!translated.alternatives) return { alternatives: [], notes };
      ruleAlternatives = translated.alternatives;
    }
    alternatives = alternatives.flatMap((terms) => ruleAlternatives.map((more) => [...terms, ...more]));
  }
  return {
    // `x` and `-x` together match nothing.
    alternatives: alternatives.map((terms) => [...new Set(terms)]).filter((terms) => !terms.some((term) => term.startsWith('-') && terms.includes(term.slice(1)))),
    notes: [...new Set(notes)],
  };
}

/**
 * The alternatives (each a list of search terms, ANDed) that select what one Graphite rule other than PR status
 * selects, or null when GitHub cannot search for it, with notes on what they approximate or leave out. `mergedOnly`:
 * the rule's group selects merged pull requests only, whose latest activity is their merge.
 */
function translateRule({ isNegated, conditions }: GraphiteRule, viewer: string | null, mergedOnly: boolean): { alternatives: string[][] | null; notes: string[] } {
  const [first] = conditions;
  if (!first) throw new Error('A Graphite rule needs a condition');
  const kind = first.kind;
  const { label, field, verbs = ['is', 'is not'] } = (Object.hasOwn(RULE_KINDS, kind) ? RULE_KINDS[kind] : undefined) ?? { label: kind };
  // A link shared "for the recipient" carries <REPLACE_USERNAME> where the sharer's login was, and Graphite's own copy
  // holds the viewer's login; both are searched as @me.
  const values = field
    ? conditions.map((condition) => String(condition[field])).map((value) => (value === '<REPLACE_USERNAME>' || (field === 'username' && value.toLowerCase() === viewer) ? '@me' : value))
    : [];
  // The rule the way Graphite's filter editor words it.
  const quoted = values.length > 0 ? `“${label} ${verbs[isNegated ? 1 : 0]} ${values.join(' or ')}${kind === 'LAST_UPDATED' ? ' hours ago' : ''}”` : `“${label}”`;

  if (kind === 'LAST_UPDATED') {
    // "Less than N hours" is active since then; "greater than" (negated) is older. ORed windows widen to the longest.
    const hours = Math.max(...values.map(Number));
    const days = Math.max(1, Math.round(hours / 24));
    return {
      alternatives: [[`${mergedOnly ? 'merged' : 'updated'}:${isNegated ? '<' : '>='}{{${days}d}}`]],
      notes: hours === days * 24 ? [] : [`${quoted} is rounded to ${days} ${days === 1 ? 'day' : 'days'}.`],
    };
  }

  const notes = isNegated && kind === 'AUTHOR_IS' && values.includes('A bot') ? [`${quoted}: “A bot” is searched as -author:app/dependabot -author:app/github-actions, so other bots still show.`] : [];
  const perCondition = values.map((value) => searchForCondition(kind, value, isNegated));

  if (isNegated) {
    // NOT (a OR b) is (NOT a) AND (NOT b): every exclusion GitHub can search for, so leaving one out only widens.
    if (!field) return { alternatives: [[]], notes: [`${quoted} has no GitHub search equivalent; that rule was left out, so more pull requests show.`] };
    const missing = values.filter((_, index) => perCondition[index] === null);
    if (missing.length > 0) notes.push(`${quoted}: ${missing.join(', ')} has no GitHub search equivalent and was left out, so more pull requests show.`);
    let alternatives: string[][] = [[]];
    for (const excluded of perCondition) {
      if (excluded) alternatives = alternatives.flatMap((terms) => excluded.map((more) => [...terms, ...more]));
    }
    return { alternatives, notes };
  }
  // (a OR something GitHub cannot search for) cannot be narrowed at all, and searching the group without it would widen
  // it, so the group goes.
  if (!field || perCondition.some((alternatives) => alternatives === null)) {
    return { alternatives: null, notes: [`${quoted} has no GitHub search equivalent; that filter group was left out.`] };
  }
  const alternatives = perCondition.flatMap((selected) => selected ?? []);
  // Several labels, any one of which will do: GitHub's comma list.
  if (kind === 'HAS_LABEL' && values.length > 1) return { alternatives: [[`label:${values.map((value) => `"${value}"`).join(',')}`]], notes };
  // GitHub's review: qualifier holds one decision per pull request, so review alternatives spread over the group, where a
  // rule excluding one of them leaves the others. Other values, any one of which will do, are one (a OR b) term.
  if (kind !== 'REVIEW_STATUS_IS' && alternatives.every((terms) => terms.length === 1)) {
    const any = [...new Set(alternatives.flat())];
    return { alternatives: [[any.length === 1 ? any.join('') : `(${any.join(' OR ')})`]], notes };
  }
  return { alternatives, notes };
}

/**
 * The alternatives (each a list of search terms, ANDed) that select the pull requests meeting one Graphite condition,
 * or with `negated` those that do not, or null where GitHub's search has no qualifier for it. Verified against the
 * user's live Graphite inbox (docs/research/graphite-sections.md, "Verified mapping").
 */
function searchForCondition(kind: string, value: string, negated: boolean): string[][] | null {
  const not = negated ? '-' : '';
  const team = value.includes('/');
  switch (kind) {
    case 'AUTHOR_IS':
      if (value === 'A bot') return negated ? [['-author:app/dependabot', '-author:app/github-actions']] : null;
      if (team) return null;
      // Dependabot opens its pull requests as the app/dependabot bot.
      if (value.toLowerCase() === 'dependabot') return negated ? [['-author:dependabot', '-author:app/dependabot']] : [['author:dependabot'], ['author:app/dependabot']];
      return [[`${not}author:${value}`]];
    case 'REVIEW_STATUS_IS':
      switch (value) {
        case 'ONE_OR_MORE_APPROVALS':
        case 'IS_FULLY_APPROVED':
        case 'APPROVED_GITHUB':
          return [[`${not}review:approved`]];
        case 'HAS_CHANGES_REQUESTED':
        case 'HAS_UNADDRESSED_CHANGES_REQUESTED':
          return [[`${not}review:changes_requested`]];
        case 'REVIEW_REQUIRED_GITHUB':
          // review:required misses a third of them; review:none matches only ready pull requests, and only says so with
          // draft:false.
          return negated ? [['-review:none']] : [['review:none', 'draft:false']];
        case 'HAS_ACTIVE_REVIEW':
          return negated ? [['-review:approved', '-review:changes_requested']] : [['review:approved'], ['review:changes_requested']];
        default:
          return null;
      }
    case 'APPROVED_BY':
      // Nobody approves their own pull request, but reviewed-by: counts their replies.
      if (team) return null;
      return negated ? [[`-reviewed-by:${value}`], [`author:${value}`]] : [[`reviewed-by:${value}`, `-author:${value}`]];
    case 'CLOSED_REVIEW_REQUEST_FROM':
      // Reviewed, and not asked again.
      if (team) return null;
      return negated ? [[`-reviewed-by:${value}`], [`review-requested:${value}`]] : [[`reviewed-by:${value}`, `-review-requested:${value}`]];
    case 'INCLUDES_PAST_REVIEWER':
      return team ? null : [[`${not}reviewed-by:${value}`]];
    case 'OPEN_REVIEW_REQUEST_FOR':
    case 'REOPENED_REVIEW_REQUEST_FOR':
      return [[team ? `${not}team-review-requested:${value}` : `${not}review-requested:${value}`]];
    case 'INCLUDES_DIRECT_REVIEWER':
      return team ? null : [[`${not}user-review-requested:${value}`]];
    case 'INCLUDES_DIRECT_TEAM_REVIEWER':
      return [[`${not}team-review-requested:${value}`]];
    case 'INCLUDES_ASSIGNEE':
      return team ? null : [[`${not}assignee:${value}`]];
    case 'MENTIONS':
      return [[team ? `${not}team:${value}` : `${not}mentions:${value}`]];
    case 'HAS_LABEL':
      return [[`${not}label:"${value}"`]];
    case 'TITLE_CONTAINS':
      return [['in:title', `${negated ? 'NOT ' : ''}"${value}"`]];
    case 'DESCRIPTION_CONTAINS':
      return [['in:body', `${negated ? 'NOT ' : ''}"${value}"`]];
    case 'MERGE_BASE_IS':
      return [[`${not}base:${value}`]];
    default:
      return null;
  }
}

/**
 * Graphite's condition kinds: its filter editor's label and operators for each (for notes and the section editor), and
 * the field holding a condition's value; no field for kinds GitHub cannot search by.
 */
export const RULE_KINDS: Record<string, { label: string; field?: string; verbs?: [string, string] }> = {
  CONSOLIDATED_PR_STATUS_IS: { label: 'PR status', field: 'status' },
  AUTHOR_IS: { label: 'Author', field: 'username' },
  REVIEW_STATUS_IS: { label: 'Review status', field: 'state', verbs: ['equals', 'does not equal'] },
  APPROVED_BY: { label: 'Approvers', field: 'username', verbs: ['include', 'do not include'] },
  INCLUDES_ASSIGNEE: { label: 'Assignees', field: 'username', verbs: ['include', 'do not include'] },
  INCLUDES_PAST_REVIEWER: { label: 'Previous reviewers', field: 'username', verbs: ['include', 'do not include'] },
  INCLUDES_DIRECT_REVIEWER: { label: 'Direct reviewers', field: 'username', verbs: ['include', 'do not include'] },
  INCLUDES_DIRECT_TEAM_REVIEWER: { label: 'Requested team reviewers', field: 'slug', verbs: ['include', 'do not include'] },
  OPEN_REVIEW_REQUEST_FOR: { label: 'Requested reviewers', field: 'username', verbs: ['include', 'do not include'] },
  CLOSED_REVIEW_REQUEST_FROM: { label: 'Active reviewers', field: 'username', verbs: ['include', 'do not include'] },
  REOPENED_REVIEW_REQUEST_FOR: { label: 'Re-requested reviewers', field: 'username', verbs: ['include', 'do not include'] },
  MENTIONS: { label: 'Mentions', field: 'username', verbs: ['include', 'do not include'] },
  HAS_LABEL: { label: 'Labels', field: 'label', verbs: ['include', 'do not include'] },
  TITLE_CONTAINS: { label: 'Title', field: 'text', verbs: ['contains', 'does not contain'] },
  DESCRIPTION_CONTAINS: { label: 'Description', field: 'text', verbs: ['contains', 'does not contain'] },
  MERGE_BASE_IS: { label: 'Parent branch', field: 'mergeBase' },
  LAST_UPDATED: { label: 'Latest activity', field: 'hours', verbs: ['less than', 'greater than'] },
  NUM_FILES_CHANGED: { label: 'Number of files changed' },
  NUM_LINES_CHANGED: { label: 'Number of lines changed' },
  IS_EXTERNAL_REPOSITORY: { label: 'PR origin' },
  PR_OPENING_SOURCE_IS: { label: 'Source' },
};

/**
 * Graphite's PR statuses in GitHub's states: 1 open and ready, 2 open draft, 4 merged, 8 closed unmerged. Open holds
 * drafts (Graphite's Drafts section is "Open and Draft"); Merging, Graphite's merge queue, has no state of its own.
 */
const PR_STATES: Record<string, number> = { OPEN: 0b0011, DRAFT: 0b0010, MERGED: 0b0100, CLOSED: 0b1000 };

/** The search terms selecting each set of states that one GitHub search can select (open-or-merged only roughly). */
const STATE_TERMS: Record<number, string[]> = {
  0b1001: ['draft:false', '-is:merged'],
  0b0001: ['is:open', 'draft:false'],
  0b0010: ['is:open', 'draft:true'],
  0b0011: ['is:open'],
  0b0100: ['is:merged'],
  0b1000: ['is:closed', '-is:merged'],
  0b1100: ['is:closed'],
  0b1011: ['-is:merged'],
  0b1101: ['draft:false'],
  0b0111: ['is:open'],
  0b1111: [],
};

/**
 * The sections a decoded payload holds: a bare filter (one unnamed section), Graphite's list of named sections, or what
 * its inbox page holds.
 */
function sectionsIn(payload: unknown, source: string): GraphiteSection[] {
  const filter = groupsOf(payload);
  if (filter) return [{ name: null, filter, repos: [], usesInboxRepos: false, notes: [] }];

  const shared = graphiteSharedSections.safeParse(payload);
  if (shared.success) {
    const sections = shared.data.map(({ name, filter, repos = [] }): GraphiteSection | null => {
      const groups = groupsOf(filter);
      return groups && { name, filter: groups, repos, usesInboxRepos: false, notes: [] };
    });
    if (sections.every((section) => section !== null)) return sections;
  }

  const inbox = graphiteInboxSections.safeParse(payload);
  if (inbox.success) {
    return inbox.data.sections.map((section) => {
      const groups = groupsOf(section.filter);
      // Sections on the inbox's repositories leave them to the inbox's scope rather than repeat them in every view.
      return {
        name: section.name,
        filter: groups,
        repos: 'repos' in section ? section.repos : [],
        usesInboxRepos: !('repos' in section),
        notes: groups ? [] : ['Graphite holds its filter in a form this import cannot read; that section was left out.'],
      };
    });
  }

  throw new Error(
    `${source} does not hold a Graphite section: expected { groups: [{ rules: [{ isNegated, conditions }] }] }, its { kind: 'OR', exprs } tree, or a list of { name, filter, repos }.`,
  );
}

/**
 * A section filter's groups in the share-link form, or null when it is in neither of Graphite's forms. The inbox page
 * holds the filter as a tree, OR(groups → AND(rules → OR(conditions) or NOT(OR(conditions)))); a level that is not its
 * connective counts as a list of one.
 */
function groupsOf(filter: unknown): GraphiteFilter | null {
  const written = graphiteFilterSchema.safeParse(filter);
  if (written.success) return written.data;
  if (!graphiteTreeNode.safeParse(filter).success) return null;
  // The operands of a `connective` node; any other node is the only one.
  const operands = (node: unknown, connective: string): unknown[] => {
    const tree = graphiteTreeNode.safeParse(node);
    return tree.success && tree.data.kind === connective && tree.data.exprs ? tree.data.exprs : [node];
  };
  const converted = {
    groups: operands(filter, 'OR').map((group) => ({
      rules: operands(group, 'AND').map((rule) => {
        const tree = graphiteTreeNode.safeParse(rule);
        return tree.success && tree.data.kind === 'NOT' ? { isNegated: true, conditions: operands(tree.data.expr, 'OR') } : { isNegated: false, conditions: operands(rule, 'OR') };
      }),
    })),
  };
  return graphiteFilterSchema.safeParse(converted).data ?? null;
}

/** A list of repositories the way Graphite writes them, `{ owner, name, forge? }`. */
const graphiteRepos = z.array(z.object({ owner: z.string(), name: z.string() }));

/** A React fiber the way `inboxSnapshotOf` walks it: page objects, so nothing about them is certain. */
const fiberSchema = z.object({ memoizedProps: z.unknown().optional(), return: z.unknown().optional() });

/** The props of the component holding Graphite's inbox: its `snapshot` of the sections and the synced repositories. */
const inboxStateProps = z.object({
  snapshot: z.object({
    sections: z.array(
      z
        .object({
          name: z.unknown().optional(),
          filter: z.unknown().optional(),
          repos: z.unknown().optional(),
          usesDefaultRepos: z.unknown().optional(),
          includeInTotalCount: z.unknown().optional(),
        })
        .nullable()
        .catch(null),
    ),
    syncedRepos: z.array(z.object({ owner: z.unknown().optional(), name: z.unknown().optional(), isInvalid: z.unknown().optional() }).nullable().catch(null)).catch([]),
  }),
});

type InboxState = z.infer<typeof inboxStateProps>['snapshot'];

/** The props of Graphite's signed-in-user context: `{ user: { githubLogin, github: { login } } }`. */
const signedInUserProps = z.object({
  value: z.object({
    user: z.object({
      githubLogin: z.string().nullish().catch(null),
      github: z.object({ login: z.string().nullish().catch(null) }).nullish().catch(null),
    }),
  }),
});

/** A `?shared-sections=` link's sections: each named, with a filter in either form and, maybe, its repositories. */
const graphiteSharedSections = z.array(z.object({ name: z.string(), filter: z.unknown(), repos: graphiteRepos.optional() })).min(1);

/** What Graphite's inbox page holds, read: each section on the inbox's repositories (`usesDefaultRepos`) or its own. */
const graphiteInboxSections = z.object({
  sections: z
    .array(
      z.union([
        z.object({ name: z.string(), filter: z.unknown().optional(), usesDefaultRepos: z.literal(true) }),
        z.object({ name: z.string(), filter: z.unknown().optional(), repos: graphiteRepos }),
      ]),
    )
    .min(1),
  defaultRepos: graphiteRepos,
});

/** A node of the inbox page's filter tree: a connective over `exprs`, NOT over `expr`, or a condition. */
const graphiteTreeNode = z.object({ kind: z.string(), exprs: z.array(z.unknown()).optional().catch(undefined), expr: z.unknown().optional() });
