// Graphite's PR-inbox sections as inbox views. Graphite shares one section's filter as
// `https://app.graphite.com/?new-section=<…>` and every section (name, filter, repositories) as `?shared-sections=<…>`,
// both `btoa(encodeURIComponent(JSON))`. A filter ORs its groups, ANDs a group's rules and ORs a rule's conditions
// (one kind per rule), and `isNegated` negates a whole rule. GitHub's search cannot OR across qualifiers, so each
// group becomes a view of its own. See docs/research/graphite-sections.md.

import type { View } from './model';

/**
 * The views that pasted Graphite section links (one per line) or their decoded JSON describe, plus a note, per section,
 * on every filter GitHub's search only approximates or cannot express. Throws an Error saying what is wrong with junk.
 */
export function importGraphiteSections(input: string): { views: View[]; notes: string[] } {
  const views: View[] = [];
  const notes: string[] = [];
  for (const section of readSections(input)) {
    const name = section.name?.trim() || 'Imported section';
    // A filter with no groups matches every pull request.
    const groups = section.filter.groups.length > 0 ? section.filter.groups : [{ rules: [] }];
    if (groups.length > 1) {
      notes.push(`${name}: Graphite matches any of its ${groups.length} filter groups; GitHub's search cannot, so each group is a view of its own.`);
    }
    groups.forEach((group, index) => {
      const viewName = groups.length > 1 ? `${name} (${index + 1})` : name;
      // GitHub ORs repeated repo: qualifiers.
      const terms = ['is:pr', ...section.repos.map((repo) => `repo:${repo.owner}/${repo.name}`)];
      const viewNotes = new Set<string>();
      for (const rule of group.rules) {
        const translated = translateRule(rule);
        terms.push(...translated.terms);
        for (const note of translated.notes) viewNotes.add(`${viewName}: ${note}`);
      }
      notes.push(...viewNotes);
      views.push({ id: crypto.randomUUID(), name: viewName, query: [...new Set([...terms, 'sort:updated-desc'])].join(' ') });
    });
  }
  return { views, notes };
}

/** A section as pasted; only `shared-sections` links carry a name and repositories. */
interface GraphiteSection {
  name: string | null;
  filter: GraphiteFilter;
  repos: Array<{ owner: string; name: string }>;
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

/** The GitHub search terms that select what one Graphite rule selects, and notes on what they approximate or leave out. */
function translateRule({ isNegated, conditions }: GraphiteRule): { terms: string[]; notes: string[] } {
  const kind = conditions[0]!.kind;
  const { label, field, verbs = ['is', 'is not'] } = Object.hasOwn(RULE_KINDS, kind) ? RULE_KINDS[kind]! : { label: kind };
  // A link shared "for the recipient" carries <REPLACE_USERNAME> where the sharer's login was.
  const values = field ? conditions.map((condition) => String(condition[field])).map((value) => (value === '<REPLACE_USERNAME>' ? '@me' : value)) : [];
  // The rule as Graphite's filter editor words it.
  const quoted = values.length > 0 ? `“${label} ${verbs[isNegated ? 1 : 0]} ${values.join(' or ')}${kind === 'LAST_UPDATED' ? ' hours ago' : ''}”` : `“${label}”`;
  const leftOut = `${quoted} has no GitHub search equivalent; that rule was left out.`;
  if (!field) return { terms: [], notes: [leftOut] };

  if (kind === 'CONSOLIDATED_PR_STATUS_IS') {
    // The pull requests a rule selects, as a set of GitHub's four states; one search can select only some such sets.
    if (!values.every((status) => Object.hasOwn(PR_STATES, status))) return { terms: [], notes: [leftOut] };
    let states = 0;
    for (const status of values) states |= PR_STATES[status]!;
    if (isNegated) states = 0b1111 & ~states;
    const terms = STATE_TERMS[states];
    if (!terms) return { terms: [], notes: [leftOut] };
    const notes: string[] = [];
    if (values.includes('MERGING')) notes.push(`${quoted}: Merging (Graphite's merge queue) is searched as open.`);
    if (states === 0b0111) notes.push(`${quoted} is searched as is:open, which leaves out merged pull requests.`);
    return { terms, notes };
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

/** The sections a decoded payload holds: a bare filter (one unnamed section) or Graphite's list of named sections. */
function sectionsIn(payload: unknown, source: string): GraphiteSection[] {
  if (isGraphiteFilter(payload)) return [{ name: null, filter: payload, repos: [] }];
  if (Array.isArray(payload) && payload.length > 0 && payload.every(isSharedSection)) {
    return payload.map((section) => ({ name: section.name, filter: section.filter, repos: section.repos ?? [] }));
  }
  throw new Error(`${source} does not hold a Graphite section: expected { groups: [{ rules: [{ isNegated, conditions }] }] } or a list of { name, filter, repos }.`);
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

/** Whether an entry of a `shared-sections` list is a section as Graphite shares it. */
function isSharedSection(value: unknown): value is { name: string; filter: GraphiteFilter; repos?: Array<{ owner: string; name: string }> } {
  const { name, filter, repos } = (value ?? {}) as { name?: unknown; filter?: unknown; repos?: unknown };
  return (
    typeof name === 'string' &&
    isGraphiteFilter(filter) &&
    (repos === undefined ||
      (Array.isArray(repos) &&
        repos.every((repo: unknown) => typeof (repo as { owner?: unknown } | null)?.owner === 'string' && typeof (repo as { name?: unknown } | null)?.name === 'string')))
  );
}
