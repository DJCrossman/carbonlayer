// The GitHub API client: GraphQL and REST calls with the user's PAT. Every failure becomes an Error whose
// message the UI can show verbatim.

const API = 'https://api.github.com';

/** Runs a GraphQL document. Keeps partial data when the only errors are FORBIDDEN / NOT_FOUND sub-fields. */
export async function graphql<T>(token: string, query: string, variables: Record<string, unknown>): Promise<T> {
  const response = await callGitHub(token, `${API}/graphql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Github-Next-Global-ID': '1' },
    body: JSON.stringify({ query, variables }),
  });
  const { data, errors } = (await response.json()) as { data?: T | null; errors?: Array<{ type?: string; message: string; path?: unknown[] }> };
  if (!errors?.length) return data as T;
  if (errors.some((error) => error.type === 'RATE_LIMITED')) throw rateLimitError(response);
  if (data && errors.every((error) => error.type === 'FORBIDDEN' || error.type === 'NOT_FOUND')) {
    console.warn('[github] partial GraphQL response', errors.map((error) => `${error.path?.join('.') ?? '?'}: ${error.message}`));
    return data;
  }
  throw new Error(errors.map((error) => error.message).join('; '));
}

/** Runs a REST request. `path` is relative to api.github.com or an absolute API URL (as in `Link` headers). */
export async function rest<T>(token: string, path: string, init?: RequestInit): Promise<{ body: T; link: string | null }> {
  const response = await callGitHub(token, path.startsWith(API) ? path : `${API}${path}`, {
    ...init,
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...init?.headers },
  });
  return { body: (await response.json()) as T, link: response.headers.get('Link') };
}

/** The one place a request leaves for GitHub: requires a token and turns HTTP failures into readable errors. */
async function callGitHub(token: string, url: string, init: RequestInit): Promise<Response> {
  if (!token) throw new Error('Add a GitHub token in the extension options');
  let response: Response;
  try {
    response = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
  } catch {
    throw new Error('Could not reach GitHub (network error)');
  }
  if (response.ok) return response;

  const text = await response.text();
  if (response.status === 401) throw new Error('GitHub rejected the token (bad credentials). Check it in the extension options.');
  if (
    (response.status === 403 || response.status === 429) &&
    (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after'))
  ) {
    throw rateLimitError(response);
  }
  if (response.status === 403 && /SAML/i.test(text)) {
    throw new Error(
      'This organisation uses SAML single sign-on: authorise the token for it at https://github.com/settings/tokens (Configure SSO), then retry.',
    );
  }
  let message = response.statusText;
  try {
    message = (JSON.parse(text) as { message?: string }).message ?? message;
  } catch {
    // Not JSON: keep the status text.
  }
  throw new Error(`GitHub returned ${response.status}: ${message}`);
}

/** When the user may try again, from the primary (`x-ratelimit-reset`) or secondary (`retry-after`) limit headers. */
function rateLimitError(response: Response): Error {
  const reset = Number(response.headers.get('x-ratelimit-reset'));
  const retryAfter = Number(response.headers.get('retry-after'));
  const resetsAt = reset > 0 ? new Date(reset * 1000) : new Date(Date.now() + (retryAfter > 0 ? retryAfter : 60) * 1000);
  return new Error(`GitHub rate limit reached, resets at ${resetsAt.toLocaleTimeString()}`);
}
