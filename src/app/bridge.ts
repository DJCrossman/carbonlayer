// postMessage protocol between the github.com content script (parent) and the app iframe (child).
// Both sides check `origin`: the parent only accepts messages from the extension origin, the child
// only from https://github.com.

export type ParentToAppMessage =
  | { type: 'gg:route'; hash: string }
  | { type: 'gg:theme'; theme: 'light' | 'dark' }
  /** A keydown that happened in the top document while the iframe did not have focus. */
  | { type: 'gg:keydown'; key: string; code: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }
  /** The top window was focused: the iframe's own window hears of a window focus only when it lands inside the frame. */
  | { type: 'gg:focus' };

export type AppToParentMessage =
  | { type: 'gg:ready' }
  /** Navigate the top window (same tab unless `newTab`). */
  | { type: 'gg:navigate'; url: string; newTab?: boolean }
  /** Replace the top window's URL without reloading (stack navigation that the app handled itself). */
  | { type: 'gg:replace-url'; url: string }
  | { type: 'gg:title'; title: string }
  /** Hand this visit back to GitHub (`?gh=1`, the PR page's `g h`); the header's "GitHub" switch remembers the choice. */
  | { type: 'gg:open-native' };

export const GITHUB_ORIGIN = 'https://github.com';

/** Whether a postMessage payload is one of this protocol's messages; the receiver has already checked who sent it. */
export function isBridgeMessage<M extends ParentToAppMessage | AppToParentMessage>(data: unknown): data is M {
  return typeof data === 'object' && data !== null && typeof (data as { type?: unknown }).type === 'string' && (data as { type: string }).type.startsWith('gg:');
}

/** Sends a message to the embedding github.com page; a no-op when the app is opened directly (harness). */
export function postToParent(message: AppToParentMessage): void {
  if (window.parent === window) return;
  window.parent.postMessage(message, GITHUB_ORIGIN);
}
