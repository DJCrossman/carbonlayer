// Toolbar popup: switch the inbox and PR page takeovers on or off, open the inbox or the options.
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { getSettings, setSettings, watchSettings, type Settings } from '../../src/lib/settings';
import '../../src/ui/tokens.css';
import './popup.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Popup />
  </StrictMode>,
);

function Popup() {
  const [settings, setLocalSettings] = useState<Settings | null>(null);

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
    void setSettings(patch);
  }

  return (
    <main className="popup">
      <h1>Graphite-style GitHub</h1>
      <label className="toggle">
        <input type="checkbox" checked={settings.inboxEnabled} onChange={(event) => toggle({ inboxEnabled: event.target.checked })} />
        Inbox at github.com/pulls
      </label>
      <label className="toggle">
        <input type="checkbox" checked={settings.prEnabled} onChange={(event) => toggle({ prEnabled: event.target.checked })} />
        Pull request pages
      </label>
      <p className="hint">Uses your github.com sign-in. Switches apply to open GitHub tabs at once.</p>
      <div className="actions">
        <button
          type="button"
          className="primary"
          onClick={() => {
            void browser.tabs.create({ url: 'https://github.com/pulls' });
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
