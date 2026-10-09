// Round avatar for a user (or team) at `size` px; falls back to a coloured initial when the image is missing or fails.
import { useState } from 'react';
import type { UserRef } from '../lib/model';
import './ui.css';

export function Avatar({ user, size = 20 }: { user: UserRef; size?: number }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (user.avatarUrl && failedUrl !== user.avatarUrl) {
    return (
      <img
        className="gg-avatar"
        src={user.avatarUrl}
        width={size}
        height={size}
        alt=""
        title={user.login}
        loading="lazy"
        onError={() => setFailedUrl(user.avatarUrl)}
      />
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
      title={user.login}
      aria-hidden
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}
