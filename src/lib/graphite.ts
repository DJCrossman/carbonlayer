// Graphite's PR-inbox sections as inbox views. Graphite shares one section's filter as
// `https://app.graphite.com/?new-section=<…>` and every section (name, filter, repositories) as `?shared-sections=<…>`,
// both `btoa(encodeURIComponent(JSON))`; its signed-in inbox page holds every section in React's state, which
// `inboxSnapshotOf` copies out. A filter ORs its groups, ANDs a group's rules and ORs a rule's conditions (one kind per
// rule), and `isNegated` negates a whole rule; the inbox page holds the same filter as an OR / AND / NOT tree. A section
// becomes one view: GitHub's search ORs parenthesised groups, `is:pr ((a b) OR (c))`, up to five operators a query.
// See docs/research/graphite-sections.md.

import type { View } from './model';

/**
 * The views that pasted Graphite section links (one per line), their decoded JSON, or the sections copied from
 * Graphite's inbox page describe: one per section, with notes on what GitHub's search only approximates or cannot
 * express. Also how many sections there were, notes on any that could not be imported, and the inbox scope that stands
 * for the inbox's repositories when a section searches those. `viewerLogin`, Graphite's signed-in user (the inbox page's
 * copy names its own), is searched as `@me`. Throws an Error saying what is wrong with junk.
 */
export function importGraphiteSections(
  input: string | GraphiteInboxSnapshot,
  options: { viewerLogin?: string } = {},
): { views: Array<{ view: View; notes: string[] }>; notes: string[]; sectionCount: number; inboxScope: string | null } {
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
    // A filter with no groups matches every pull request.
    const translated = (section.filter.groups.length > 0 ? section.filter.groups : [{ rules: [] }]).map((group) => translateGroup(group.rules, viewer));
    // An OR gains nothing from a group twice, or from a group with every term of another: it only narrows that one.
    const groups = translated.filter(
      (group, index) =>
        !translated.some(
          (other, otherIndex) =>
            otherIndex !== index && other.terms.every((term) => group.terms.includes(term)) && (other.terms.length < group.terms.length || otherIndex < index),
        ),
    );
    // GitHub ORs repeated repo: qualifiers.
    const scope = ['is:pr', ...section.repos.map((repo) => `repo:${repo.owner}/${repo.name}`)];
    // One search holds at most five AND / OR / NOT operators.
    const operators = groups.length - 1 + groups.flatMap((group) => group.terms).filter((term) => term.startsWith('NOT ')).length;
    if (operators <= 5) {
      // Terms every group has are searched once, before the alternatives; the outer parentheses keep an inbox scope
      // written in front of the query applying to every alternative.
      const common = groups[0]!.terms.filter((term) => groups.every((group) => group.terms.includes(term)));
      const alternatives = groups.map((group) => `(${group.terms.filter((term) => !common.includes(term)).join(' ')})`);
      const query = [...scope, ...common, ...(groups.length > 1 ? [`(${alternatives.join(' OR ')})`] : []), 'sort:updated-desc'];
      views.push({ view: { id: crypto.randomUUID(), name, query: [...new Set(query)].join(' ') }, notes: [...new Set([...section.notes, ...groups.flatMap((group) => group.notes)])] });
    } else {
      const split = `Graphite matches any of its ${groups.length} filter groups, more than one GitHub search can OR; each group is a view of its own.`;
      groups.forEach((group, index) =>
        views.push({
          view: { id: crypto.randomUUID(), name: `${name} (${index + 1})`, query: [...new Set([...scope, ...group.terms, 'sort:updated-desc'])].join(' ') },
          notes: [...new Set([...section.notes, split, ...group.notes])],
        }),
      );
    }
  }
  const inboxScope =
    typeof input !== 'string' && sections.some((section) => section.usesInboxRepos) && input.defaultRepos.length > 0
      ? input.defaultRepos.map((repo) => `repo:${repo.owner}/${repo.name}`).join(' ')
      : null;
  return { views, notes, sectionCount: sections.length, inboxScope };
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
  const key = Object.keys(element).find((name) => name.startsWith('__reactFiber$'));
  let fiber = key ? (element as Record<string, Fiber | null | undefined>)[key] : null;
  let snapshot: { sections: Array<Record<string, unknown> | null>; syncedRepos?: unknown } | null = null;
  let viewerLogin: string | undefined;
  for (let depth = 0; fiber; depth += 1, fiber = fiber.return) {
    const props = fiber.memoizedProps;
    const sections = props?.snapshot?.sections;
    if (!snapshot && Array.isArray(sections)) snapshot = { sections, syncedRepos: props?.snapshot?.syncedRepos };
    // Not an element of the inbox.
    if (!snapshot && depth >= 100) return null;
    // Further up, Graphite's signed-in-user context provides { user: { githubLogin, github: { login } } }.
    const login = props?.value?.user?.githubLogin ?? props?.value?.user?.github?.login;
    if (snapshot && typeof login === 'string' && login) {
      viewerLogin = login;
      break;
    }
  }
  if (!snapshot) return null;
  const syncedRepos: Array<Record<string, unknown> | null> = Array.isArray(snapshot.syncedRepos) ? snapshot.syncedRepos : [];
  return JSON.parse(
    JSON.stringify({
      sections: snapshot.sections.map((section) => ({
        name: section?.name,
        filter: section?.filter,
        repos: section?.repos,
        usesDefaultRepos: section?.usesDefaultRepos,
        includeInTotalCount: section?.includeInTotalCount,
      })),
      // The inbox's "N repos selected", without the ones Graphite can no longer reach.
      defaultRepos: syncedRepos.filter((repo) => repo && !repo.isInvalid).map((repo) => ({ owner: repo?.owner, name: repo?.name })),
      viewerLogin,
    }),
  ) as GraphiteInboxSnapshot;
}

/** What Graphite's inbox page holds, as `inboxSnapshotOf` copies it out of the page. */
export interface GraphiteInboxSnapshot {
  /** `filter` is the OR / AND / NOT tree; `usesDefaultRepos` sections search `defaultRepos` instead of `repos`. */
  sections: Array<{ name: string; filter: unknown; repos: Array<{ owner: string; name: string }>; usesDefaultRepos: boolean; includeInTotalCount: boolean }>;
  /** The repositories the inbox covers (its "N repos selected"). */
  defaultRepos: Array<{ owner: string; name: string }>;
  /** Who is signed in to Graphite, when the page said. */
  viewerLogin?: string;
}

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

interface GraphiteFilter {
  groups: Array<{ rules: GraphiteRule[] }>;
}

interface GraphiteRule {
  isNegated: boolean;
  /** Never empty, and every condition has the same kind. */
  conditions: Array<{ kind: string } & Record<string, unknown>>;
}

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
 * The GitHub search terms one group of a filter comes to (its rules ANDed, no term twice), and notes on what they
 * approximate or leave out. `viewer` is the signed-in user's login in lower case.
 */
function translateGroup(rules: GraphiteRule[], viewer: string | null): { terms: string[]; notes: string[] } {
  const terms: string[] = [];
  const notes: string[] = [];
  // The PR-status rules together allow one set of GitHub's states, searched where the first of them was.
  let states = 0b1111;
  let statusAt: number | null = null;
  const statusRules: string[] = [];
  for (const rule of rules) {
    const translated = translateRule(rule, viewer);
    notes.push(...translated.notes);
    if (!translated.status) {
      terms.push(...translated.terms);
      continue;
    }
    states &= translated.status.states;
    statusAt ??= terms.length;
    statusRules.push(translated.status.wording);
  }
  if (statusAt !== null) {
    const stateTerms = STATE_TERMS[states];
    const wording = statusRules.join(' and ');
    if (!stateTerms) {
      notes.push(statusRules.length > 1 ? `${wording} have no GitHub search equivalent together; those rules were left out.` : `${wording} has no GitHub search equivalent; that rule was left out.`);
    } else {
      terms.splice(statusAt, 0, ...stateTerms);
      if (states === 0b0111) notes.push(`${wording} is searched as is:open, which leaves out merged pull requests.`);
    }
  }
  return { terms: [...new Set(terms)], notes: [...new Set(notes)] };
}

/**
 * The GitHub search terms that select what one Graphite rule selects, and notes on what they approximate or leave out.
 * A PR-status rule instead gives the set of GitHub's states it allows (see PR_STATES), for its group to combine.
 */
function translateRule({ isNegated, conditions }: GraphiteRule, viewer: string | null): { terms: string[]; notes: string[]; status?: { states: number; wording: string } } {
  const kind = conditions[0]!.kind;
  const { label, field, verbs = ['is', 'is not'] } = Object.hasOwn(RULE_KINDS, kind) ? RULE_KINDS[kind]! : { label: kind };
  // A link shared "for the recipient" carries <REPLACE_USERNAME> where the sharer's login was, and Graphite's own copy
  // holds the viewer's login; both are searched as @me.
  const values = field
    ? conditions.map((condition) => String(condition[field])).map((value) => (value === '<REPLACE_USERNAME>' || (field === 'username' && value.toLowerCase() === viewer) ? '@me' : value))
    : [];
  // The rule as Graphite's filter editor words it.
  const quoted = values.length > 0 ? `“${label} ${verbs[isNegated ? 1 : 0]} ${values.join(' or ')}${kind === 'LAST_UPDATED' ? ' hours ago' : ''}”` : `“${label}”`;
  const leftOut = `${quoted} has no GitHub search equivalent; that rule was left out.`;
  if (!field) return { terms: [], notes: [leftOut] };

  if (kind === 'CONSOLIDATED_PR_STATUS_IS') {
    if (!values.every((status) => Object.hasOwn(PR_STATES, status))) return { terms: [], notes: [leftOut] };
    // Merging (Graphite's merge queue) is part of open: searched as open, and impossible to exclude.
    let states = 0;
    for (const status of values) states |= isNegated && status === 'MERGING' ? 0 : PR_STATES[status]!;
    const notes = !values.includes('MERGING')
      ? []
      : [isNegated ? `${quoted}: pull requests in Graphite's merge queue cannot be excluded, so they still show.` : `${quoted}: Merging (Graphite's merge queue) is searched as open.`];
    return { terms: [], notes, status: { states: isNegated ? 0b1111 & ~states : states, wording: quoted } };
  }

  if (kind === 'LAST_UPDATED') {
    // "Less than N hours" is updated since then; "greater than" (negated) is older. ORed windows widen to the longest.
    const hours = Math.max(...values.map(Number));
    const days = Math.max(1, Math.round(hours / 24));
    return {
      terms: [`updated:${isNegated ? '<' : '>='}{{${days}d}}`],
      notes: hours === days * 24 ? [] : [`${quoted} is rounded to ${days} ${days === 1 ? 'day' : 'days'}.`],
    };
  }

  const notes: string[] = [];
  const not = isNegated ? '-' : '';
  // Each condition's terms, or null where GitHub has no qualifier for it.
  const perCondition = values.map((value): string[] | null => {
    const team = value.includes('/');
    switch (kind) {
      case 'AUTHOR_IS':
        if (value === 'A bot') {
          if (!isNegated) return null;
          notes.push(`${quoted}: “A bot” is searched as -author:app/dependabot -author:app/github-actions, so other bots still show.`);
          return ['-author:app/dependabot', '-author:app/github-actions'];
        }
        return team ? null : [`${not}author:${value}`];
      case 'REVIEW_STATUS_IS':
        if (value === 'HAS_ONE_OR_MORE_REQUESTED_REVIEWERS') notes.push(`${quoted}: requested reviewers are searched as review:required.`);
        return Object.hasOwn(REVIEW_TERMS, value) ? [`${not}${REVIEW_TERMS[value]}`] : null;
      case 'APPROVED_BY':
      case 'INCLUDES_PAST_REVIEWER':
      case 'CLOSED_REVIEW_REQUEST_FROM':
        notes.push(`${quoted} is searched as reviewed-by:, which counts any review.`);
        return team ? null : [`${not}reviewed-by:${value}`];
      case 'REOPENED_REVIEW_REQUEST_FOR':
        notes.push(`${quoted} is searched as an open review request, re-requested or not.`);
        return [team ? `${not}team-review-requested:${value}` : `${not}review-requested:${value}`];
      case 'OPEN_REVIEW_REQUEST_FOR':
        return [team ? `${not}team-review-requested:${value}` : `${not}review-requested:${value}`];
      case 'INCLUDES_DIRECT_REVIEWER':
        return team ? null : [`${not}user-review-requested:${value}`];
      case 'INCLUDES_DIRECT_TEAM_REVIEWER':
        return [`${not}team-review-requested:${value}`];
      case 'INCLUDES_ASSIGNEE':
        return team ? null : [`${not}assignee:${value}`];
      case 'MENTIONS':
        return [team ? `${not}team:${value}` : `${not}mentions:${value}`];
      case 'HAS_LABEL':
        return [`${not}label:"${value}"`];
      case 'TITLE_CONTAINS':
        return ['in:title', `${isNegated ? 'NOT ' : ''}"${value}"`];
      case 'DESCRIPTION_CONTAINS':
        return ['in:body', `${isNegated ? 'NOT ' : ''}"${value}"`];
      case 'MERGE_BASE_IS':
        return [`${not}base:${value}`];
      default:
        return null;
    }
  });
  const known = perCondition.filter((terms) => terms !== null);

  if (isNegated) {
    // NOT (a OR b) is (NOT a) AND (NOT b): every exclusion GitHub can search for, so leaving one out only widens.
    const missing = values.filter((_, index) => perCondition[index] === null);
    if (missing.length > 0) notes.push(`${quoted}: ${missing.join(', ')} has no GitHub search equivalent and was left out, so more pull requests show.`);
    return { terms: known.flat(), notes };
  }
  // (a OR something GitHub cannot search for) cannot be narrowed at all.
  if (known.length < perCondition.length) return { terms: [], notes: [...notes, leftOut] };
  if (new Set(known.map((terms) => terms.join(' '))).size === 1) return { terms: known[0]!, notes };
  // Several values, any one of which will do.
  if (kind === 'HAS_LABEL') return { terms: [`label:${values.map((value) => `"${value}"`).join(',')}`], notes };
  // GitHub ORs repeated author: qualifiers.
  if (kind === 'AUTHOR_IS') return { terms: known.flat(), notes };
  if (field === 'username' || field === 'slug') {
    return { terms: known.flat(), notes: [...notes, `${quoted}: Graphite matches any one of them; GitHub may match only pull requests with all of them.`] };
  }
  return { terms: [], notes: [...notes, `${quoted}: GitHub's search cannot match any one of several values; that rule was left out.`] };
}

/**
 * Graphite's condition kinds: its filter editor's label and operators for each (for notes), and the field holding a
 * condition's value; no field for kinds GitHub cannot search by.
 */
const RULE_KINDS: Record<string, { label: string; field?: string; verbs?: [string, string] }> = {
  CONSOLIDATED_PR_STATUS_IS: { label: 'PR status', field: 'status' },
  AUTHOR_IS: { label: 'Author', field: 'username' },
  REVIEW_STATUS_IS: { label: 'Review status', field: 'state' },
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

/** Graphite's PR statuses as GitHub's states: 1 open and ready, 2 open draft, 4 merged, 8 closed unmerged. */
const PR_STATES: Record<string, number> = { OPEN: 0b0001, DRAFT: 0b0010, MERGING: 0b0011, MERGED: 0b0100, CLOSED: 0b1000 };

/** The search terms selecting each set of states that one GitHub search can select (open-or-merged only roughly). */
const STATE_TERMS: Record<number, string[]> = {
  0b1001: ['draft:false', '-is:merged'],
  0b0001: ['is:open', 'draft:false'],
  0b0010: ['is:open', 'draft:true'],
  0b0011: ['is:open'],
  0b0100: ['is:merged'],
  0b1000: ['is:closed', 'is:unmerged'],
  0b1100: ['is:closed'],
  0b1011: ['-is:merged'],
  0b1101: ['draft:false'],
  0b0111: ['is:open'],
  0b1111: [],
};

const REVIEW_TERMS: Record<string, string> = {
  ONE_OR_MORE_APPROVALS: 'review:approved',
  IS_FULLY_APPROVED: 'review:approved',
  APPROVED_GITHUB: 'review:approved',
  HAS_CHANGES_REQUESTED: 'review:changes_requested',
  HAS_UNADDRESSED_CHANGES_REQUESTED: 'review:changes_requested',
  REVIEW_REQUIRED_GITHUB: 'review:required',
  HAS_ONE_OR_MORE_REQUESTED_REVIEWERS: 'review:required',
};

/**
 * The sections a decoded payload holds: a bare filter (one unnamed section), Graphite's list of named sections, or what
 * its inbox page holds.
 */
function sectionsIn(payload: unknown, source: string): GraphiteSection[] {
  const filter = groupsOf(payload);
  if (filter) return [{ name: null, filter, repos: [], usesInboxRepos: false, notes: [] }];

  if (Array.isArray(payload) && payload.length > 0) {
    const sections = payload.map((entry: unknown): GraphiteSection | null => {
      const { name, filter, repos = [] } = (entry ?? {}) as { name?: unknown; filter?: unknown; repos?: unknown };
      const groups = groupsOf(filter);
      return typeof name === 'string' && groups && isRepoList(repos) ? { name, filter: groups, repos, usesInboxRepos: false, notes: [] } : null;
    });
    if (sections.every((section) => section !== null)) return sections;
  }

  const { sections, defaultRepos } = (payload ?? {}) as { sections?: unknown; defaultRepos?: unknown };
  if (
    Array.isArray(sections) &&
    sections.length > 0 &&
    isRepoList(defaultRepos) &&
    sections.every((section: unknown) => {
      const { name, repos, usesDefaultRepos } = (section ?? {}) as { name?: unknown; repos?: unknown; usesDefaultRepos?: unknown };
      return typeof name === 'string' && (usesDefaultRepos === true || isRepoList(repos));
    })
  ) {
    return (sections as GraphiteInboxSnapshot['sections']).map((section) => {
      const groups = groupsOf(section.filter);
      // Sections on the inbox's repositories leave them to the inbox's scope rather than repeat them in every view.
      return {
        name: section.name,
        filter: groups,
        repos: section.usesDefaultRepos ? [] : section.repos,
        usesInboxRepos: section.usesDefaultRepos === true,
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
  if (isGraphiteFilter(filter)) return filter;
  if (typeof (filter as { kind?: unknown } | null)?.kind !== 'string') return null;
  // The operands of a `connective` node; any other node is the only one.
  const operands = (node: unknown, connective: string): unknown[] => {
    const { kind, exprs } = (node ?? {}) as { kind?: unknown; exprs?: unknown };
    return kind === connective && Array.isArray(exprs) ? exprs : [node];
  };
  const converted = {
    groups: operands(filter, 'OR').map((group) => ({
      rules: operands(group, 'AND').map((rule) => {
        const { kind, expr } = (rule ?? {}) as { kind?: unknown; expr?: unknown };
        return kind === 'NOT' ? { isNegated: true, conditions: operands(expr, 'OR') } : { isNegated: false, conditions: operands(rule, 'OR') };
      }),
    })),
  };
  return isGraphiteFilter(converted) ? converted : null;
}

/** Whether a decoded payload is a section filter as Graphite writes it, with the value every known condition kind needs. */
function isGraphiteFilter(value: unknown): value is GraphiteFilter {
  const groups = (value as { groups?: unknown } | null)?.groups;
  return (
    Array.isArray(groups) &&
    groups.every((group: unknown) => {
      const rules = (group as { rules?: unknown } | null)?.rules;
      return (
        Array.isArray(rules) &&
        rules.every((rule: unknown) => {
          const { isNegated, conditions } = (rule ?? {}) as { isNegated?: unknown; conditions?: unknown };
          if (typeof isNegated !== 'boolean' || !Array.isArray(conditions) || conditions.length === 0) return false;
          const kind = (conditions[0] as { kind?: unknown } | null)?.kind;
          if (typeof kind !== 'string') return false;
          const field = Object.hasOwn(RULE_KINDS, kind) ? RULE_KINDS[kind]!.field : undefined;
          return conditions.every((condition: unknown) => {
            const fields = condition as Record<string, unknown> | null;
            return fields?.kind === kind && (!field || typeof fields[field] === (field === 'hours' ? 'number' : 'string'));
          });
        })
      );
    })
  );
}

/** Whether a value is a list of repositories as Graphite writes them, `{ owner, name, forge? }`. */
function isRepoList(value: unknown): value is Array<{ owner: string; name: string }> {
  return (
    Array.isArray(value) &&
    value.every((repo: unknown) => typeof (repo as { owner?: unknown } | null)?.owner === 'string' && typeof (repo as { name?: unknown } | null)?.name === 'string')
  );
}

/** A React fiber as `inboxSnapshotOf` walks it: page objects, so nothing about them is certain. */
interface Fiber {
  memoizedProps?: {
    snapshot?: { sections?: unknown; syncedRepos?: unknown } | null;
    value?: { user?: { githubLogin?: unknown; github?: { login?: unknown } | null } | null } | null;
  } | null;
  return?: Fiber | null;
}
