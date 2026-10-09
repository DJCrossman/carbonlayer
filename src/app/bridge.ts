// postMessage protocol between the github.com content script (parent) and the app iframe (child).
// Both sides check `origin`: the parent only accepts messages from the extension origin, the child
// only from https://github.com.

export type ParentToAppMessage =
  | { type: 'gg:route'; hash: string }
  | { type: 'gg:theme'; theme: 'light' | 'dark' }
  /** A keydown that happened in the top document while the iframe did not have focus. */
  | { type: 'gg:keydown'; key: string; code: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean };

export type AppToParentMessage =
  | { type: 'gg:ready' }
  /** Navigate the top window (same tab unless `newTab`). */
  | { type: 'gg:navigate'; url: string; newTab?: boolean }
  /** Replace the top window's URL without reloading (stack navigation that the app handled itself). */
  | { type: 'gg:replace-url'; url: string }
  | { type: 'gg:title'; title: string }
  /** Hand the page back to GitHub (the "GitHub view" escape hatch). */
  | { type: 'gg:open-native' };

export const GITHUB_ORIGIN = 'https://github.com';

export function isParentToAppMessage(data: unknown): data is ParentToAppMessage {
  return typeof data === 'object' && data !== null && typeof (data as { type?: unknown }).type === 'string' && (data as { type: string }).type.startsWith('gg:');
}

export function isAppToParentMessage(data: unknown): data is AppToParentMessage {
  return isParentToAppMessage(data);
}

/** Sends a message to the embedding github.com page; a no-op when the app is opened directly (harness). */
export function postToParent(message: AppToParentMessage): void {
  if (window.parent === window) return;
  window.parent.postMessage(message, GITHUB_ORIGIN);
}
