// Options page: inbox scope and views, PR page preferences, on/off switches.
// Every change is saved as it is made (text fields 400 ms after the last keystroke).
import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { RepoPicker } from '../../src/inbox/RepoPicker';
import { repositoryCandidatesFrom, repositoryPickerPath } from '../../src/lib/github-web/repositories';
import type { RepoCandidate } from '../../src/lib/model';
import { getSettings, setSettings, type Settings } from '../../src/lib/settings';
import { Icon } from '../../src/ui/Icon';
import '../../src/ui/tokens.css';
import { repositoryScope } from '../../src/lib/views';
import './options.css';
import { ViewsEditor } from './ViewsEditor';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <OptionsPage />
  </StrictMode>,
);

function OptionsPage() {
  const [settings, setLocalSettings] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);
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

  async function save(patch: Partial<Settings>) {
    await setSettings(patch);
    setSaved(true);
    window.clearTimeout(savedTimer.current);
    savedTimer.current = window.setTimeout(() => setSaved(false), 1500);
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
      </header>

      <section>
        <h2>Inbox</h2>
        <div className="field">
          <span>Repositories</span>
          <RepoPicker
            selected={settings.inboxRepos}
            emptyLabel={settings.inboxScope || 'All repositories'}
            searchRepos={searchRepositories}
            onChange={(inboxRepos) => update({ inboxRepos, inboxScope: repositoryScope(inboxRepos) })}
          />
        </div>
        <p className="hint">
          Every search view searches these, unless it names repositories of its own; GitHub's inbox sections use GitHub's own repository filter.
          {settings.inboxScope && (
            <>
              {' '}
              Searched as <code>{settings.inboxScope}</code>.
            </>
          )}
        </p>
        <ViewsEditor views={settings.views} searchRepos={searchRepositories} onChange={(views, typing) => update({ views }, typing ? 400 : 0)} />
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
    </main>
  );
}

/**
 * The repositories GitHub's repository picker offers for what the user typed. The options page is no github.com page,
 * so it asks github.com itself; the extension's host permission lets the request carry the user's session.
 */
async function searchRepositories(query: string): Promise<RepoCandidate[]> {
  let response: Response;
  try {
    response = await fetch(`https://github.com${repositoryPickerPath(query.trim())}`, {
      credentials: 'include',
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    });
  } catch {
    throw new Error('could not reach GitHub');
  }
  if (response.redirected && new URL(response.url).pathname === '/login') throw new Error('sign in to github.com first');
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
  return repositoryCandidatesFrom(await response.json());
}
