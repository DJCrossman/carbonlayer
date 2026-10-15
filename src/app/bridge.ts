// postMessage protocol between the github.com content script (parent) and the app iframe (child).
// Both sides check `origin`: the parent only accepts messages from the extension origin, the child
// only from https://github.com. Each reads what it got by the other side's schema: GitHub's own page posts to the
// frame too, so a message of no shape here is someone else's and is left alone.

import { z } from 'zod/mini';

/** What the github.com page tells the app. */
export const parentToAppMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('gg:route'), hash: z.string() }),
  z.object({ type: z.literal('gg:theme'), theme: z.enum(['light', 'dark']) }),
  /** A keydown that happened in the top document while the iframe did not have focus. */
  z.object({
    type: z.literal('gg:keydown'),
    key: z.string(),
    code: z.string(),
    altKey: z.boolean(),
    ctrlKey: z.boolean(),
    metaKey: z.boolean(),
    shiftKey: z.boolean(),
  }),
  /** The top window was focused: the iframe's own window hears of a window focus only when it lands inside the frame. */
  z.object({ type: z.literal('gg:focus') }),
  /** Who is signed in to github.com (`<meta name="user-login">`), null for no one: whose cache the app restores. */
  z.object({ type: z.literal('gg:viewer'), login: z.nullable(z.string()) }),
]);

export type ParentToAppMessage = z.infer<typeof parentToAppMessage>;

/** What the app asks of the github.com page. */
export const appToParentMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('gg:ready') }),
  /** Navigate the top window (same tab unless `newTab`). */
  z.object({ type: z.literal('gg:navigate'), url: z.string(), newTab: z.optional(z.boolean()) }),
  /** Replace the top window's URL without reloading (stack navigation that the app handled itself). */
  z.object({ type: z.literal('gg:replace-url'), url: z.string() }),
  z.object({ type: z.literal('gg:title'), title: z.string() }),
  /** Hand this visit back to GitHub (`?gh=1`, the PR page's `g h`); the header's "GitHub" switch remembers the choice. */
  z.object({ type: z.literal('gg:open-native') }),
]);

export type AppToParentMessage = z.infer<typeof appToParentMessage>;

export const GITHUB_ORIGIN = 'https://github.com';

/** Sends a message to the embedding github.com page; a no-op when the app is opened directly (harness). */
export function postToParent(message: AppToParentMessage): void {
  if (window.parent === window) return;
  window.parent.postMessage(message, GITHUB_ORIGIN);
}
