import { afterEach, describe, expect, it, vi } from 'vitest';
import { graphql, rest } from './client';

afterEach(() => vi.unstubAllGlobals());

describe('GitHub client errors', () => {
  it('asks for a token before calling GitHub', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(graphql('', 'query { viewer { login } }', {})).rejects.toThrow('Add a GitHub token in the extension options');
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    [new Response('{"message":"Bad credentials"}', { status: 401 }), 'GitHub rejected the token (bad credentials). Check it in the extension options.'],
    [new Response('{"message":"Resource protected by organization SAML enforcement."}', { status: 403 }), 'SAML single sign-on'],
    [new Response('{}', { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1800000000' } }), 'GitHub rate limit reached, resets at'],
    [new Response('{"message":"Not Found"}', { status: 404 }), 'GitHub returned 404: Not Found'],
  ])('explains HTTP failures (%#)', async (response, message) => {
    vi.stubGlobal('fetch', vi.fn(async () => response));
    await expect(rest('token', '/repos/acme/widgets')).rejects.toThrow(message);
  });

  it('keeps partial data when only sub-fields are forbidden or missing, and fails otherwise', async () => {
    const reply = (body: unknown) => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body))));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    reply({ data: { repository: { p0: { number: 1 }, p1: null } }, errors: [{ type: 'NOT_FOUND', path: ['repository', 'p1'], message: 'Could not resolve' }] });
    await expect(graphql('token', 'query', {})).resolves.toEqual({ repository: { p0: { number: 1 }, p1: null } });

    reply({ data: null, errors: [{ message: 'Field x does not exist' }, { message: 'Field y does not exist' }] });
    await expect(graphql('token', 'query', {})).rejects.toThrow('Field x does not exist; Field y does not exist');

    reply({ data: null, errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded' }] });
    await expect(graphql('token', 'query', {})).rejects.toThrow('GitHub rate limit reached');
  });

  it('returns the Link header for pagination', async () => {
    const fetch = vi.fn(async () => new Response('[]', { headers: { Link: '<https://api.github.com/x?page=2>; rel="next"' } }));
    vi.stubGlobal('fetch', fetch);
    await expect(rest('token', 'https://api.github.com/x?page=1')).resolves.toEqual({ body: [], link: '<https://api.github.com/x?page=2>; rel="next"' });
    expect(fetch).toHaveBeenCalledWith('https://api.github.com/x?page=1', expect.anything());
  });
});
