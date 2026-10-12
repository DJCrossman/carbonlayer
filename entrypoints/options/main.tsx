// Options page: the inbox's organization, and that organization's repositories and views; PR page preferences, on/off
// switches. Every change is saved as it is made (text fields 400 ms after the last keystroke).
import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { OrgPicker, useOrganizations } from '../../src/inbox/OrgPicker';
import { RepoPicker } from '../../src/inbox/RepoPicker';
import { listOrganizations } from '../../src/lib/github-web/organizations';
import { pickableRepositories } from '../../src/lib/github-web/repositories';
import type { Organization } from '../../src/lib/model';
import { getSettings, setSettings, type Settings } from '../../src/lib/settings';
import { organizationScope } from '../../src/lib/views';
import { Icon } from '../../src/ui/Icon';
import '../../src/ui/tokens.css';
import './options.css';
import { ViewsEditor } from './ViewsEditor';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <OptionsPage />
  </StrictMode>,
);

function OptionsPage() {
  const organizations = useOrganizations(() =>
    listOrganizations(
      {
        json: async (path) => (await fromGitHub(path, 'application/json')).json(),
        page: async (path) => new DOMParser().parseFromString(await (await fromGitHub(path, 'text/html')).text(), 'text/html'),
      },
      null,
    ),
  );
  const [settings, setLocalSettings] = useState<Settings | null>(null);
  // Whether the first organization chosen keeps the views saved before views belonged to one.
  const [keepViews, setKeepViews] = useState(true);
  const [saved, setSaved] = useState(false);
  // Why the last save failed (Chrome refusing the write), until one succeeds.
  const [problem, setProblem] = useState<string | null>(null);
  const pending = useRef<Partial<Settings>>({});
  const saveTimer = useRef<number | undefined>(undefined);
  const savedTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    void getSettings().then(setLocalSettings);
  }, []);

  const theme = settings?.theme;
  useEffect(() => {
    if (!theme) return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => (document.documentElement.dataset.theme = theme === 'auto' ? (media.matches ? 'dark' : 'light') : theme);
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);

  if (!settings) return null;

  /** The settings as saved with `patch`; null when Chrome refused, which the header then says. */
  async function save(patch: Partial<Settings>): Promise<Settings | null> {
    let next: Settings;
    try {
      next = await setSettings(patch);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
      return null;
    }
    setProblem(null);
    setSaved(true);
    window.clearTimeout(savedTimer.current);
    savedTimer.current = window.setTimeout(() => setSaved(false), 1500);
    return next;
  }

  /** Shows another organization's repositories and views, after saving what was still waiting for this one's. */
  async function chooseOrg(org: Organization) {
    if (!settings) return;
    window.clearTimeout(saveTimer.current);
    const waiting = pending.current;
    pending.current = {};
    if (Object.keys(waiting).length > 0) await save(waiting);
    const keep = settings.viewsUnassigned && keepViews;
    const switched = await save({ currentOrg: org, ...(keep && { views: settings.views, inboxRepos: settings.inboxRepos }) });
    if (switched) setLocalSettings(switched);
  }

  /** Shows a change at once and saves it, batched with anything still waiting, after `debounceMs`. */
  function update(patch: Partial<Settings>, debounceMs = 0) {
    setLocalSettings((current) => current && { ...current, ...patch });
    pending.current = { ...pending.current, ...patch };
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const batch = pending.current;
      pending.current = {};
      void save(batch);
    }, debounceMs);
  }

  return (
    <main className="options">
      <header>
        <Icon name="logo" size={28} />
        <div className="brand">
          <h1>CarbonLayer</h1>
          <p className="slogan">We have Graphite at home</p>
        </div>
        <span className={saved ? 'saved visible' : 'saved'} aria-live="polite">
          {saved ? 'Saved' : ''}
        </span>
        {problem && (
          <span className="problem" role="alert">
            Could not save: {problem}
          </span>
        )}
      </header>

      <section>
        <h2>Inbox</h2>
        <div className="field">
          <span>Organization</span>
          <OrgPicker organizations={organizations} current={settings.currentOrg} onChange={(org) => void chooseOrg(org)} />
        </div>
        {settings.viewsUnassigned && (
          <label className="check hint">
            <input type="checkbox" checked={keepViews} onChange={(event) => setKeepViews(event.target.checked)} />
            Keep my current views for the organization I choose
          </label>
        )}
        {settings.currentOrg ? (
          <OrganizationInbox org={settings.currentOrg} settings={settings} update={update} />
        ) : (
          <p className="hint">Choose an organization to edit its sections: the inbox shows one organization's pull requests at a time, each with its own sections and repositories.</p>
        )}
      </section>

      <section>
        <h2>Pull request page</h2>
        <label className="field">
          <span>Diff layout</span>
          <select value={settings.diffLayout} onChange={(event) => update({ diffLayout: event.target.value as Settings['diffLayout'] })}>
            <option value="unified">Unified</option>
            <option value="split">Split</option>
          </select>
        </label>
        <label className="field">
          <span>Merge method</span>
          <select value={settings.mergeMethod} onChange={(event) => update({ mergeMethod: event.target.value as Settings['mergeMethod'] })}>
            <option value="MERGE">Create a merge commit</option>
            <option value="SQUASH">Squash and merge</option>
            <option value="REBASE">Rebase and merge</option>
          </select>
        </label>
        <label className="field">
          <span>Theme</span>
          <select value={settings.theme} onChange={(event) => update({ theme: event.target.value as Settings['theme'] })}>
            <option value="auto">Match GitHub</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
      </section>

      <section>
        <h2>Enable</h2>
        <label className="check">
          <input type="checkbox" checked={settings.inboxEnabled} onChange={(event) => update({ inboxEnabled: event.target.checked })} />
          Show the pull request inbox on the github.com homepage
        </label>
        <label className="check">
          <input type="checkbox" checked={settings.prEnabled} onChange={(event) => update({ prEnabled: event.target.checked })} />
          Replace pull request pages
        </label>
      </section>
      <footer className="support">
        <a href="https://buymeacoffee.com/djcrossman" target="_blank" rel="noopener">
          ☕ Buy me a coffee
        </a>
      </footer>
    </main>
  );
}

/** The chosen organization's repositories and views. */
function OrganizationInbox({ org, settings, update }: { org: Organization; settings: Settings; update: (patch: Partial<Settings>, debounceMs?: number) => void }) {
  // GitHub's repository picker, the organization's repositories only.
  const searchRepos = (query: string) => pickableRepositories(query.trim(), org, async (path) => (await fromGitHub(path, 'application/json')).json());
  return (
    <>
      <div className="field">
        <span>Repositories</span>
        <RepoPicker
          selected={settings.inboxRepos}
          emptyLabel={`All of ${org.login}'s repositories`}
          searchRepos={searchRepos}
          onChange={(inboxRepos) => update({ inboxRepos, inboxScope: organizationScope(org, inboxRepos) })}
        />
      </div>
      <p className="hint">
        Every search view searches these, unless it names repositories of its own; GitHub's inbox sections use GitHub's own repository filter. Searched as{' '}
        <code>{settings.inboxScope}</code>.
      </p>
      {/* Another organization's views start their own draft. */}
      <ViewsEditor key={org.login} views={settings.views} searchRepos={searchRepos} onChange={(views, typing) => update({ views }, typing ? 400 : 0)} />
    </>
  );
}

/**
 * A github.com route with the user's session. The options page is no github.com page, so it asks github.com itself; the
 * extension's host permission lets the request carry the user's session.
 */
async function fromGitHub(path: string, accept: 'application/json' | 'text/html'): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`https://github.com${path}`, {
      credentials: 'include',
      headers: accept === 'application/json' ? { Accept: accept, 'X-Requested-With': 'XMLHttpRequest' } : { Accept: accept },
    });
  } catch {
    throw new Error('could not reach GitHub');
  }
  if (response.redirected && new URL(response.url).pathname === '/login') throw new Error('sign in to github.com first');
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
  return response;
}
