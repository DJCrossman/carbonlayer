// Toolbar popup: switch the inbox and PR page takeovers on or off, open the inbox or the options.
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { getSettings, setSettings, watchSettings, type Settings } from '../../src/lib/settings';
import { Icon } from '../../src/ui/Icon';
import '../../src/ui/tokens.css';
import './popup.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Popup />
  </StrictMode>,
);

function Popup() {
  const [settings, setLocalSettings] = useState<Settings | null>(null);
  // Why the last switch did not save (Chrome refusing the write).
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    void getSettings().then(setLocalSettings);
    return watchSettings(setLocalSettings);
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

  function toggle(patch: Partial<Pick<Settings, 'inboxEnabled' | 'prEnabled'>>) {
    setLocalSettings((current) => current && { ...current, ...patch });
    setSettings(patch).then(
      () => setProblem(null),
      (error: unknown) => {
        setProblem(error instanceof Error ? error.message : String(error));
        void getSettings().then(setLocalSettings);
      },
    );
    // The tab in view changes now, as the header's switch would change it; other tabs follow when they load again.
    void browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (tab?.id === undefined) return;
      for (const [surface, showOurs] of Object.entries(patch)) void browser.tabs.sendMessage(tab.id, { type: 'gg:choose', surface, showOurs }).catch(() => {});
    });
  }

  return (
    <main className="popup">
      <header className="brand">
        <Icon name="logo" size={24} />
        <h1>CarbonLayer</h1>
        <p className="slogan">We have Graphite at home</p>
      </header>
      <label className="toggle">
        <input type="checkbox" checked={settings.inboxEnabled} onChange={(event) => toggle({ inboxEnabled: event.target.checked })} />
        Inbox on the github.com homepage
      </label>
      <label className="toggle">
        <input type="checkbox" checked={settings.prEnabled} onChange={(event) => toggle({ prEnabled: event.target.checked })} />
        Pull request pages
      </label>
      {problem && (
        <p className="hint problem" role="alert">
          Could not save: {problem}
        </p>
      )}
      <p className="hint">Uses your github.com sign-in. A switch changes the tab in view and what new tabs start with.</p>
      <div className="actions">
        <button
          type="button"
          className="primary"
          onClick={() => {
            void browser.tabs.create({ url: 'https://github.com/' });
            window.close();
          }}
        >
          Open inbox
        </button>
        <button type="button" onClick={() => void browser.runtime.openOptionsPage()}>
          Options
        </button>
      </div>
    </main>
  );
}
