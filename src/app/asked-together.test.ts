import { describe, expect, it } from 'vitest';
import { askedTogether } from './asked-together';

describe('askedTogether', () => {
  it('asks for what was asked for together in requests of perRequest, atOnce at a time, in the order asked for', async () => {
    const requests: number[][] = [];
    let inFlight = 0;
    let most = 0;
    const ask = askedTogether(
      async (keys: number[]) => {
        requests.push(keys);
        most = Math.max(most, ++inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return keys.map((key) => key * 10);
      },
      { perRequest: 2, atOnce: 2 },
    );
    expect(await Promise.all([1, 2, 3, 4, 5].map((key) => ask(key)))).toEqual([10, 20, 30, 40, 50]);
    expect(requests).toEqual([[1, 2], [3, 4], [5]]);
    expect(most).toBe(2);
  });

  it('fails only the queries a failed request was asking for', async () => {
    const ask = askedTogether(
      async (keys: number[]) => {
        if (keys.includes(3)) throw new Error('GitHub answered 502');
        return keys;
      },
      { perRequest: 2, atOnce: 1 },
    );
    const answers = await Promise.allSettled([1, 2, 3, 4].map((key) => ask(key)));
    expect(answers.map((answer) => answer.status)).toEqual(['fulfilled', 'fulfilled', 'rejected', 'rejected']);
  });
});
