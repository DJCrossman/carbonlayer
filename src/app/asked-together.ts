// GitHub answers several things in one request (a PR's diffs, the inbox's sections, its rows' details and branches),
// while the page's queries ask for one thing each.

/**
 * A query function for one thing at a time that asks `ask` about several at once: what is asked for within `gatherMs` of
 * each other goes together, `perRequest` things a request and `atOnce` requests at a time, in the order asked for. `ask`
 * answers in the same order; when it fails, so does every query it was asking for.
 */
export function askedTogether<K, V>(
  ask: (keys: K[]) => Promise<V[]>,
  { perRequest, atOnce, gatherMs = 0 }: { perRequest: number; atOnce: number; gatherMs?: number },
): (key: K) => Promise<V> {
  const queue: Array<{ key: K; resolve: (value: V) => void; reject: (reason: unknown) => void }> = [];
  let asking = 0;
  let gathering = false;

  // Each request in flight takes the next things in the queue once answered, until it is empty.
  const askInTurn = async () => {
    while (queue.length > 0) {
      const batch = queue.splice(0, perRequest);
      try {
        const answers = await ask(batch.map((entry) => entry.key));
        batch.forEach((entry, index) => entry.resolve(answers[index] as V));
      } catch (reason) {
        for (const entry of batch) entry.reject(reason);
      }
    }
    asking -= 1;
  };

  return (key) =>
    new Promise<V>((resolve, reject) => {
      queue.push({ key, resolve, reject });
      if (gathering) return;
      gathering = true;
      setTimeout(() => {
        gathering = false;
        while (asking < atOnce && queue.length > 0) {
          asking += 1;
          void askInTurn();
        }
      }, gatherMs);
    });
}
