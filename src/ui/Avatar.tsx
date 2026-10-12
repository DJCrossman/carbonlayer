// Round avatar for a user (or team) at `size` px; falls back to a coloured initial when the image is missing or fails.
// A bot (`name[bot]`, `app/name`, Copilot) shows its GitHub App's avatar when GitHub gave it none, else a bot glyph.
import { useState } from 'react';
import type { UserRef } from '../lib/model';
import { Icon } from './Icon';
import './ui.css';

export function Avatar({ user, size = 20, title = user.login }: { user: UserRef; size?: number; title?: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const bot = /^app\/|\[bot\]$|^copilot$/i.test(user.login) ? user.login.toLowerCase().replace(/^app\//, '').replace(/\[bot\]$/, '') : null;
  const appId = bot === null ? undefined : APP_IDS[bot];
  // An account GitHub gave no avatar for has the /<login>.png address (githubUser), which GitHub does not serve for bots.
  const src = appId !== undefined && (!user.avatarUrl || user.avatarUrl.startsWith('https://github.com/')) ? `https://avatars.githubusercontent.com/in/${appId}?s=${size * 2}&v=4` : user.avatarUrl;
  if (src && failedUrl !== src) {
    return <img className="gg-avatar" src={src} width={size} height={size} alt="" title={title} loading="lazy" onError={() => setFailedUrl(src)} />;
  }
  if (bot !== null) {
    return (
      <span className="gg-avatar gg-avatar--bot" style={{ width: size, height: size }} title={title} aria-hidden>
        <Icon name="hubot" size={Math.round(size * 0.75)} />
      </span>
    );
  }
  // Teams arrive as "org/slug"; the slug is the readable part.
  const name = user.login.slice(user.login.lastIndexOf('/') + 1);
  let hue = 0;
  for (const char of user.login) hue = (hue * 31 + char.charCodeAt(0)) % 360;
  return (
    <span
      className="gg-avatar gg-avatar--initial"
      style={{ width: size, height: size, lineHeight: `${size}px`, fontSize: Math.round(size * 0.5), background: `hsl(${hue} 42% 46%)` }}
      title={title}
      aria-hidden
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

/** The GitHub Apps behind the bots that review pull requests most, by bot name: their avatars are /in/<app id>. */
const APP_IDS: Record<string, number> = {
  dependabot: 29110,
  'github-actions': 15368,
  copilot: 946600,
  'copilot-pull-request-reviewer': 946600,
  renovate: 2740,
};
