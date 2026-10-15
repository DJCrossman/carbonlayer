// The section editor, Graphite's "Update section" drawer for one inbox view: its name, its repositories and its filter,
// edited row by row like Graphite's (each row one rule: what, how, which values; rows ANDed, "Add filter" ORs another
// group), or, under "Advanced", its search query by hand. Saving compiles the filter into the view's query with the same
// mapping as the Graphite import (src/lib/graphite.ts). Opened from the inbox and the options page.
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { z } from 'zod/mini';
import { RULE_KINDS, searchForFilter, type GraphiteFilter, type GraphiteRule } from '../lib/graphite';
import type { OrgMember, RepoCandidate, RepoRef, View } from '../lib/model';
import { GITHUB_INBOX_FILTERS } from '../lib/views';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { RepoPicker } from './RepoPicker';
import './section-editor.css';

export function SectionEditor({
  view,
  searchRepos,
  listPeople,
  onSave,
  onDelete,
  onClose,
}: {
  /** The view to edit, or null for a new one. */
  view: View | null;
  /** Candidates for the Repositories field, from GitHub's repository picker. */
  searchRepos: (query: string) => Promise<RepoCandidate[]>;
  /** Whom the username fields (Author, reviewers, …) offer as the user types: the organization's people. */
  listPeople: () => Promise<OrgMember[]>;
  onSave: (view: View) => void;
  /** Absent for a view not saved yet. */
  onDelete?: () => void;
  onClose: () => void;
}) {
  const nameId = useId();
  const [name, setName] = useState(view?.name ?? '');
  const [repos, setRepos] = useState<RepoRef[]>(view?.repos ?? []);
  // The filter's rows; null while the query is written by hand, as it is for a view that never had a filter.
  const [groups, setGroups] = useState<RuleGroup[] | null>(() => {
    if (!view) return [newFilterGroup()];
    return view.filter
      ? view.filter.groups.map((group) => ({
          key: crypto.randomUUID(),
          rules: group.rules.map((rule) => {
            // The filter's schema holds every rule to at least one condition, all of one kind.
            const [first] = rule.conditions;
            if (!first) throw new Error('A rule of the filter has no conditions');
            return { ...rule, key: crypto.randomUUID(), kind: first.kind };
          }),
        }))
      : null;
  });
  const [query, setQuery] = useState(view && !view.filter ? view.query : '');
  // The rows put aside while the query is written by hand, back if the user changes their mind.
  const [setAside, setSetAside] = useState<RuleGroup[] | null>(null);
  const [advanced, setAdvanced] = useState(groups === null);
  const [problem, setProblem] = useState<string | null>(null);
  // Asked for once, as the editor opens; until they come, or should they not, a login is typed as before.
  const [people, setPeople] = useState<OrgMember[]>([]);

  useEffect(() => {
    let current = true;
    listPeople().then(
      (found) => current && setPeople(found),
      (error: unknown) => console.debug('[gg]', "The organization's people did not load; logins are typed:", error instanceof Error ? error.message : error),
    );
    return () => {
      current = false;
    };
  }, []);

  // A rule still waiting for its first value stays out of the search until it has one.
  const filter: GraphiteFilter | null = groups && {
    groups: groups.map((group) => ({ rules: group.rules.filter((rule) => rule.conditions.length > 0).map(({ isNegated, conditions }) => ({ isNegated, conditions })) })),
  };
  const search = filter && searchForFilter(filter, repos);

  function changeRule(groupIndex: number, ruleIndex: number, rule: Rule | null) {
    if (!groups) return;
    setProblem(null);
    const next = groups.map((group, index) =>
      index !== groupIndex ? group : { ...group, rules: rule ? group.rules.map((other, i) => (i === ruleIndex ? rule : other)) : group.rules.filter((_, i) => i !== ruleIndex) },
    );
    // A group without rules matches everything, so it goes, unless it is the only one.
    setGroups(next.length > 1 ? next.filter((group) => group.rules.length > 0) : next);
  }

  function addRule(groupIndex: number) {
    if (!groups) return;
    setGroups(groups.map((group, index) => (index === groupIndex ? { ...group, rules: [...group.rules, { key: crypto.randomUUID(), kind: 'AUTHOR_IS', isNegated: false, conditions: [] }] } : group)));
  }

  function writeByHand() {
    setSetAside(groups);
    setQuery(search?.query ?? '');
    setGroups(null);
    setProblem(null);
  }

  function buildWithFilters() {
    setGroups(setAside ?? [newFilterGroup()]);
    setProblem(null);
  }

  function save() {
    const base = view ?? { id: crypto.randomUUID(), name: '', query: '' };
    if (!name.trim()) return setProblem('Give the section a name.');
    if (!filter) {
      if (!query.trim()) return setProblem('Write a search query, or use filters.');
      // A hand-written query names its own repositories.
      const { filter: _filter, repos: _repos, ...rest } = base;
      return onSave({ ...rest, name: name.trim(), query: query.trim() });
    }
    if (groups?.some((group) => group.rules.some((rule) => rule.conditions.length === 0))) return setProblem('Give every condition a value, or remove it.');
    if (!search?.query) return setProblem("GitHub's search can express none of these filters.");
    const { repos: _repos, ...rest } = base;
    onSave({ ...rest, name: name.trim(), query: search.query, filter, ...(repos.length > 0 && { repos }) });
  }

  return createPortal(
    <div className="gg-drawer-scrim" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside
        className="gg-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={view ? 'Update section' : 'New section'}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
          // The inbox's own shortcuts stay out of the drawer.
          event.stopPropagation();
        }}
      >
        <header className="gg-drawer__header">
          {view ? 'Update section' : 'New section'}
          <Button variant="ghost" size="sm" icon="x" aria-label="Close" onClick={onClose} />
        </header>

        <div className="gg-drawer__body gg-editor">
          <div className="gg-editor__field">
            <label htmlFor={nameId}>Section name</label>
            <input id={nameId} type="text" autoFocus value={name} placeholder="Needs my review" onChange={(event) => setName(event.target.value)} />
          </div>

          {groups && (
            <div className="gg-editor__field">
              <span className="gg-editor__label">Repositories</span>
              <RepoPicker selected={repos} emptyLabel="The inbox's repositories" searchRepos={searchRepos} onChange={setRepos} />
            </div>
          )}

          {groups && (
            <div className="gg-editor__field">
              <span className="gg-editor__label">Filters</span>
              {groups.map((group, groupIndex) => (
                <div key={group.key} className="gg-editor__group">
                  {groupIndex > 0 && (
                    <div className="gg-editor__or" role="separator">
                      Or
                    </div>
                  )}
                  {group.rules.map((rule, ruleIndex) => (
                    <RuleRow
                      key={rule.key}
                      rule={rule}
                      first={ruleIndex === 0}
                      people={people}
                      onChange={(changed) => changeRule(groupIndex, ruleIndex, changed)}
                      onRemove={() => changeRule(groupIndex, ruleIndex, null)}
                    />
                  ))}
                  <Button variant="ghost" size="sm" icon="plus" className="gg-editor__add" onClick={() => addRule(groupIndex)}>
                    Add condition
                  </Button>
                </div>
              ))}
              <Button
                size="sm"
                icon="plus"
                className="gg-editor__add-group"
                onClick={() => setGroups([...groups, newFilterGroup()])}
              >
                Add filter
              </Button>
              {search && search.notes.length > 0 && (
                <ul className="gg-editor__notes" aria-label="What GitHub's search cannot express">
                  {search.notes.map((note) => (
                    <li key={note}>
                      <Icon name="alert" size={12} />
                      {note}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="gg-editor__field">
            <button type="button" className="gg-editor__disclosure" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}>
              <Icon name={advanced ? 'chevron-down' : 'chevron-right'} size={14} />
              Advanced: edit the search query
            </button>
            {advanced &&
              (groups ? (
                <div className="gg-editor__advanced">
                  <code className="gg-editor__query">{search?.query ?? 'GitHub’s search can express none of these filters.'}</code>
                  {search && search.operators > 5 && (
                    <p className="gg-editor__warning">
                      <Icon name="alert" size={12} />
                      GitHub allows five AND / OR / NOT operators in a search; this one has {search.operators}.
                    </p>
                  )}
                  <Button size="sm" onClick={writeByHand}>
                    Write the query by hand
                  </Button>
                </div>
              ) : (
                <div className="gg-editor__advanced">
                  <textarea
                    aria-label="Search query"
                    rows={4}
                    spellCheck={false}
                    value={query}
                    placeholder="is:pr is:open review-requested:@me"
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setProblem(null);
                    }}
                  />
                  <p className="gg-editor__hint">
                    A GitHub search (<code>@me</code> is you, <code>{'{{7d}}'}</code> seven days ago; <code>repo:</code> terms search those repositories instead of
                    the inbox's) or one of GitHub's inbox sections, such as <code>inbox:{GITHUB_INBOX_FILTERS[0]}</code>.
                  </p>
                  <Button size="sm" onClick={buildWithFilters}>
                    {setAside ? 'Back to the filters' : 'Use filters instead'}
                  </Button>
                </div>
              ))}
          </div>
        </div>

        <footer className="gg-drawer__footer">
          {onDelete && (
            <Button variant="ghost" size="sm" className="gg-editor__delete" onClick={onDelete}>
              Delete section
            </Button>
          )}
          {problem && (
            <span className="gg-editor__problem" role="alert">
              {problem}
            </span>
          )}
          <Button size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" onClick={save}>
            Save
          </Button>
        </footer>
      </aside>
    </div>,
    document.body,
  );
}

/** One rule of the filter as a row: what it looks at, how (is or is not), and its values, ORed. */
function RuleRow({ rule, first, people, onChange, onRemove }: { rule: Rule; first: boolean; people: OrgMember[]; onChange: (rule: Rule) => void; onRemove: () => void }) {
  const { label, field, verbs = ['is', 'is not'] } = RULE_KINDS[rule.kind] ?? { label: rule.kind };
  // Imported filters can hold kinds the editor does not offer; they stay as they are.
  const kinds = OFFERED_KINDS.includes(rule.kind) ? OFFERED_KINDS : [...OFFERED_KINDS, rule.kind];
  // The filter's schema holds each condition to the value its kind needs: a number of hours, else a string.
  const values = field ? rule.conditions.map((condition) => z.union([z.string(), z.number()]).parse(condition[field])) : [];
  const setValues = (next: Array<string | number>) => {
    if (field) onChange({ ...rule, conditions: next.map((value) => ({ kind: rule.kind, [field]: value })) });
  };
  const choices = CHOICES[rule.kind];
  // An imported window that is not one of the editor's stays offered.
  const windows = CHOICES.LAST_UPDATED.some(([hours]) => hours === values[0]) ? CHOICES.LAST_UPDATED : [...CHOICES.LAST_UPDATED, [values[0] ?? 168, `${values[0]} hours`] as const];
  return (
    <div className="gg-editor__rule">
      <span className="gg-editor__join">{first ? '' : 'And'}</span>
      <select
        aria-label="Filter by"
        value={rule.kind}
        onChange={(event) => {
          const kind = event.target.value;
          // A kind with a fixed set of values starts on the usual one; the others wait for the user's.
          const initial = CHOICES[kind]?.[kind === 'LAST_UPDATED' ? 2 : 0]?.[0];
          const kindField = RULE_KINDS[kind]?.field;
          onChange({ ...rule, kind, conditions: initial === undefined || !kindField ? [] : [{ kind, [kindField]: initial }] });
        }}
      >
        {kinds.map((kind) => (
          <option key={kind} value={kind}>
            {RULE_KINDS[kind]?.label ?? kind}
          </option>
        ))}
      </select>
      <select aria-label={`${label}: operator`} value={rule.isNegated ? 'not' : 'is'} onChange={(event) => onChange({ ...rule, isNegated: event.target.value === 'not' })}>
        <option value="is">{verbs[0]}</option>
        <option value="not">{verbs[1]}</option>
      </select>
      <div className="gg-editor__values">
        {!field ? (
          <span className="gg-editor__hint">GitHub's search cannot filter by this</span>
        ) : rule.kind === 'LAST_UPDATED' ? (
          <select aria-label={`${label}: how long`} value={values[0]} onChange={(event) => setValues([Number(event.target.value)])}>
            {windows.map(([hours, text]) => (
              <option key={hours} value={hours}>
                {text}
              </option>
            ))}
          </select>
        ) : choices ? (
          <>
            {values.map((value) => {
              // Values the editor does not offer (Merging, say) read the way Graphite's constant does.
              const text = choices.find(([choice]) => choice === value)?.[1] ?? String(value).charAt(0) + String(value).slice(1).toLowerCase().replace(/_/g, ' ');
              return (
                <span key={value} className="gg-editor__chip">
                  {text}
                  <button type="button" aria-label={`Remove ${text}`} onClick={() => setValues(values.filter((other) => other !== value))}>
                    <Icon name="x" size={12} />
                  </button>
                </span>
              );
            })}
            {choices.some(([choice]) => !values.includes(choice)) && (
              <select aria-label={`${label}: add a value`} className="gg-editor__add-value" value="" onChange={(event) => setValues([...values, event.target.value])}>
                <option value="" disabled>
                  {values.length > 0 ? 'or…' : 'Choose…'}
                </option>
                {choices
                  .filter(([choice]) => !values.includes(choice))
                  .map(([choice, text]) => (
                    <option key={choice} value={choice}>
                      {text}
                    </option>
                  ))}
              </select>
            )}
          </>
        ) : (
          <ValuesInput
            label={label}
            values={values.map(String)}
            placeholder={field === 'username' ? 'login' : field === 'label' ? 'label' : field === 'mergeBase' ? 'branch' : 'text'}
            suggestion={field === 'username' ? '@me' : undefined}
            people={field === 'username' ? people : undefined}
            onChange={setValues}
          />
        )}
      </div>
      <Button variant="ghost" size="sm" icon="x" aria-label="Remove condition" title="Remove condition" onClick={onRemove} />
    </div>
  );
}

/**
 * Free-form values as chips: Enter, a comma or leaving the field adds what was typed, Backspace in the empty field takes
 * the last one back. `suggestion` is offered as a one-click chip while it is not among the values. With `people` (a
 * username field) the field is a combobox: the people matching what is typed are listed under it, ↑ / ↓ reach one, Enter
 * or a click adds that one's login, and Esc closes the list, not the drawer; Enter with nobody reached adds what was typed.
 */
function ValuesInput({
  label,
  values,
  placeholder,
  suggestion,
  people,
  onChange,
}: {
  label: string;
  values: string[];
  placeholder: string;
  suggestion?: string;
  people?: OrgMember[];
  onChange: (values: string[]) => void;
}) {
  const listId = useId();
  const list = useRef<HTMLUListElement | null>(null);
  const [text, setText] = useState('');
  // Whether the people matching what is typed show under the field, and which of them ↑ / ↓ or the mouse reached.
  const [listing, setListing] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  const offered = people && listing ? peopleMatching(people, text, values) : [];
  const expanded = offered.length > 0;
  const add = (typed: string) => {
    const value = typed.trim();
    if (value && !values.includes(value)) onChange([...values, value]);
    setText('');
    setListing(false);
    setActive(null);
  };

  useEffect(() => {
    // The list in view as it opens, low in the drawer too, and the person reached in view in the list.
    (active === null ? list.current : list.current?.children[active])?.scrollIntoView({ block: 'nearest' });
  }, [expanded, active]);

  return (
    <div className="gg-editor__chips">
      {values.map((value) => (
        <span key={value} className="gg-editor__chip">
          {value}
          <button type="button" aria-label={`Remove ${value}`} onClick={() => onChange(values.filter((other) => other !== value))}>
            <Icon name="x" size={12} />
          </button>
        </span>
      ))}
      <input
        type="text"
        value={text}
        aria-label={`${label}: add a value`}
        placeholder={values.length > 0 ? '' : placeholder}
        spellCheck={false}
        role={people ? 'combobox' : undefined}
        aria-autocomplete={people ? 'list' : undefined}
        aria-expanded={people ? expanded : undefined}
        aria-controls={expanded ? listId : undefined}
        aria-activedescendant={expanded && active !== null ? `${listId}-${active}` : undefined}
        onFocus={() => setListing(true)}
        onClick={() => setListing(true)}
        onChange={(event) => {
          if (event.target.value.endsWith(',')) return add(event.target.value.slice(0, -1));
          setText(event.target.value);
          setListing(true);
          setActive(null);
        }}
        onBlur={() => add(text)}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          if (people && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault();
            const options = peopleMatching(people, text, values);
            if (options.length === 0) return;
            const step = event.key === 'ArrowDown' ? 1 : -1;
            setListing(true);
            setActive(!expanded || active === null ? (step === 1 ? 0 : options.length - 1) : (active + step + options.length) % options.length);
          } else if (event.key === 'Enter') {
            event.preventDefault();
            add((active !== null && offered[active]?.login) || text);
          } else if (event.key === 'Escape' && expanded) {
            // Esc closes the list, not the drawer around it.
            event.stopPropagation();
            setListing(false);
            setActive(null);
          } else if (event.key === 'Backspace' && !text && values.length > 0) {
            onChange(values.slice(0, -1));
          }
        }}
      />
      {expanded && (
        <ul
          ref={list}
          id={listId}
          role="listbox"
          aria-label={`${label}: people`}
          className="gg-editor__people"
          // Choosing keeps the focus in the field, so leaving it adds nothing half-typed.
          onMouseDown={(event) => event.preventDefault()}
        >
          {offered.map((person, index) => (
            <li
              key={person.login}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              className="gg-editor__person"
              onMouseMove={() => setActive(index)}
              onClick={() => add(person.login)}
            >
              <Avatar user={{ login: person.login, avatarUrl: person.avatarUrl, url: '' }} size={20} />
              <span className="gg-editor__person-login">{person.login}</span>
              {person.name && <span className="gg-editor__person-name">{person.name}</span>}
            </li>
          ))}
        </ul>
      )}
      {suggestion && !values.includes(suggestion) && (
        <button type="button" className="gg-editor__suggestion" onClick={() => onChange([...values, suggestion])}>
          + {suggestion}
        </button>
      )}
    </div>
  );
}

/**
 * The people to offer for what was typed (a leading @ aside), none already chosen: everyone while nothing is typed, else
 * those whose login or name has it, case aside; first those whose login begins with it, then those with a word of their
 * name that does, then the rest, each in the People page's order.
 */
function peopleMatching(people: OrgMember[], typed: string, chosen: string[]): OrgMember[] {
  const needle = typed.trim().replace(/^@/, '').toLowerCase();
  const rank = (person: OrgMember) => {
    const login = person.login.toLowerCase();
    const name = person.name?.toLowerCase() ?? '';
    if (login.startsWith(needle)) return 0;
    if (` ${name}`.includes(` ${needle}`)) return 1;
    return login.includes(needle) || name.includes(needle) ? 2 : 3;
  };
  return people
    .filter((person) => rank(person) < 3 && !chosen.some((value) => value.toLowerCase() === person.login.toLowerCase()))
    .sort((a, b) => rank(a) - rank(b));
}

/** A rule as a row: its kind kept apart from its conditions, which are empty until the user gives a value. */
type Rule = GraphiteRule & { key: string; kind: string };
type RuleGroup = { key: string; rules: Rule[] };

/** What a new section and every filter added to it start with, as in Graphite: one row, "PR status is Open". */
function newFilterGroup(): RuleGroup {
  return { key: crypto.randomUUID(), rules: [{ key: crypto.randomUUID(), kind: 'CONSOLIDATED_PR_STATUS_IS', isNegated: false, conditions: [{ kind: 'CONSOLIDATED_PR_STATUS_IS', status: 'OPEN' }] }] };
}

/** The kinds of rule GitHub's search can express, in the order Graphite's editor lists them. */
const OFFERED_KINDS = [
  'CONSOLIDATED_PR_STATUS_IS',
  'AUTHOR_IS',
  'REVIEW_STATUS_IS',
  'OPEN_REVIEW_REQUEST_FOR',
  'INCLUDES_PAST_REVIEWER',
  'INCLUDES_ASSIGNEE',
  'HAS_LABEL',
  'MENTIONS',
  'TITLE_CONTAINS',
  'DESCRIPTION_CONTAINS',
  'MERGE_BASE_IS',
  'LAST_UPDATED',
];

/** The values offered for the kinds that have a fixed set, in the words of Graphite's editor; only those GitHub can search. */
const CHOICES: { LAST_UPDATED: Array<readonly [number, string]>; [kind: string]: Array<readonly [string | number, string]> } = {
  CONSOLIDATED_PR_STATUS_IS: [
    ['OPEN', 'Open'],
    ['DRAFT', 'Draft'],
    ['MERGED', 'Merged'],
    ['CLOSED', 'Closed'],
  ],
  REVIEW_STATUS_IS: [
    ['IS_FULLY_APPROVED', 'Approved'],
    ['ONE_OR_MORE_APPROVALS', 'At least one approval'],
    ['HAS_CHANGES_REQUESTED', 'Changes requested'],
    ['HAS_UNADDRESSED_CHANGES_REQUESTED', 'Unaddressed changes requested'],
    ['HAS_ACTIVE_REVIEW', 'Has an active review'],
    ['REVIEW_REQUIRED_GITHUB', 'Review required'],
  ],
  LAST_UPDATED: [
    [24, '1 day'],
    [72, '3 days'],
    [168, '1 week'],
    [672, '1 month'],
  ],
};
