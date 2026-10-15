import { describe, expect, it } from 'vitest';
import { appToParentMessage, parentToAppMessage } from './bridge';

describe('the bridge between github.com and the app', () => {
  it("reads each side's messages, and none of what GitHub's own page posts", () => {
    expect(parentToAppMessage.safeParse({ type: 'gg:viewer', login: null }).data).toEqual({ type: 'gg:viewer', login: null });
    expect(appToParentMessage.safeParse({ type: 'gg:navigate', url: 'https://github.com/acme/web/pull/1', newTab: true }).success).toBe(true);
    expect(parentToAppMessage.safeParse({ type: 'turbo:visit', url: '/' }).success).toBe(false);
    expect(parentToAppMessage.safeParse('{"source":"react-devtools-bridge"}').success).toBe(false);
  });

  it('refuses a message of a known type that lacks what it carries', () => {
    expect(parentToAppMessage.safeParse({ type: 'gg:theme', theme: 'sepia' }).success).toBe(false);
    expect(appToParentMessage.safeParse({ type: 'gg:navigate' }).success).toBe(false);
  });
});
