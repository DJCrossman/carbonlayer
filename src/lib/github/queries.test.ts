import { describe, expect, it } from 'vitest';
import { inboxQuery, pullRequestsByNumberQuery } from './queries';

describe('inboxQuery', () => {
  it('aliases one search per view, each with its own query and size, sharing the PrCard fragment', () => {
    const query = inboxQuery(3);
    expect(query).toContain('query Inbox($q0: String!, $first0: Int!, $q1: String!, $first1: Int!, $q2: String!, $first2: Int!)');
    expect(query).toContain('v2: search(type: ISSUE, query: $q2, first: $first2)');
    expect(query).not.toContain('v3:');
    expect(query.match(/fragment PrCard/g)).toHaveLength(1);
    expect(query).toContain('rateLimit { cost remaining resetAt }');
  });
});

describe('pullRequestsByNumberQuery', () => {
  it('aliases each PR in order and refuses anything that is not a PR number', () => {
    const query = pullRequestsByNumberQuery([12, 7]);
    expect(query).toContain('p0: pullRequest(number: 12) { ...PrCard }');
    expect(query).toContain('p1: pullRequest(number: 7) { ...PrCard }');
    expect(() => pullRequestsByNumberQuery([1.5])).toThrow();
  });
});
