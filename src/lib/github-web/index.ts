// Answers the app's RPC requests with the user's github.com session: same-origin requests from the content
// script to the endpoints GitHub's own React UI uses (docs/research/github-web-*.md). No token, no api.github.com.
// The page's own cache (src/app/query-cache.tsx) decides when to ask again, so reads go to GitHub; only the reviewer
// picker's and `pr.fetch`'s are kept briefly here, and pr-stages.ts shares a request between the PR page's stages while
// it is on its way. Any successful write clears what is kept, and stops sharing the requests made before it.

import { z } from 'zod/mini';
import type { PrDetail } from '../model';
import type { RpcMethod, RpcMethods, RpcRequest, RpcResponse } from '../rpc';
import { getSettings } from '../settings';
import { branchesHeaderAnswer, branchesIn, enrichPull, fetchInbox, fetchViewPage } from './inbox';
import { mutations, proposedMergeCommit, pullRequestFor, rememberPullRequest } from './mutations';
import { fetchFileDiffs, fetchPrStage, forgetPrAnswers } from './pr-stages';
import { fetchPullRequestPage } from './pull-request';
import { listOrganizations } from './organizations';
import { organizationPeople } from './people';
import { pickableRepositories, topRepositories } from './repositories';
import { availableReviewersAnswer, reviewerCandidatesFrom, suggestedReviewersAnswer } from './reviews';
import { getJson, getPage, politely, render } from './session';

export async function handleRpc<M extends RpcMethod>(request: RpcRequest<M>): Promise<RpcResponse> {
  try {
    if (!Object.hasOwn(handlers, request.method)) throw new Error(`Unknown request: ${String(request.method)}`);
    // The table is typed per method, so the handler for `M` takes `M`'s args.
    const handler: (args: RpcMethods[M]['args']) => Promise<RpcMethods[M]['result']> = handlers[request.method];
    const result = await handler(request.args);
    if (Object.hasOwn(mutations, request.method)) {
      for (const answers of Object.values(kept)) answers.clear();
      forgetPrAnswers();
    }
    return { kind: 'gg-rpc-result', id: request.id, ok: true, result };
  } catch (error) {
    return { kind: 'gg-rpc-result', id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

const handlers: { [M in RpcMethod]: (args: RpcMethods[M]['args']) => Promise<RpcMethods[M]['result']> } = {
  'inbox.fetch': async ({ views }) => fetchInbox(views, (await getSettings()).inboxScope),
  'inbox.fetchMore': async ({ view, page }) => fetchViewPage(view, (await getSettings()).inboxScope, page),
  'inbox.enrich': async ({ prs }) => {
    const { mergeMethod } = await getSettings();
    // The viewer's own review is found by the login of the github.com page this script runs in.
    const viewerLogin = document.querySelector('meta[name="user-login"]')?.getAttribute('content') || null;
    // Three pull requests at a time, each up to four page_data requests.
    return politely(prs, 3, (pr) => enrichPull(pr, mergeMethod, viewerLogin));
  },
  'inbox.branches': ({ prs }) =>
    // Six pull requests at a time; one GitHub does not answer has no branches.
    politely(prs, 6, ({ repo, number }) =>
      getJson(`/${repo.owner}/${repo.name}/pull/${number}/page_data/header`, branchesHeaderAnswer)
        .then((header) => branchesIn(header, repo))
        .catch((error: unknown) => {
          console.debug('[gg]', `page_data/header for ${repo.owner}/${repo.name}#${number} failed; the row waits for its merge box to name its branches:`, error instanceof Error ? error.message : error);
          return null;
        }),
    ),
  // The picker's answer is read where its envelope is looked for (repositoryCandidatesFrom).
  'repos.search': async ({ query, owner }) => pickableRepositories(query.trim(), owner ?? null, (path) => getJson(path, z.unknown())),
  'repos.top': ({ cursor }) => (cursor === undefined || cursor === null ? topRepositories() : topRepositories(cursor)),
  'orgs.list': () =>
    // Who is signed in is the github.com page's own business. The picker's answer is read by repositoryCandidatesFrom.
    listOrganizations({ json: (path) => getJson(path, z.unknown()), page: getPage }, document.querySelector('meta[name="user-login"]')?.getAttribute('content') || null),
  'orgs.people': ({ org }) => organizationPeople(org, getPage),
  'pr.fetch': async ({ repo, number, force }) => {
    const { mergeMethod } = await getSettings();
    const key = `pr:${repo.owner}/${repo.name}#${number}:${mergeMethod}`.toLowerCase();
    const detail = await cached(kept.pullRequests, key, 30_000, force, () => fetchPullRequestPage(repo, number));
    rememberPullRequest(detail);
    return detail;
  },
  // The PR page, a stage at a time; pr-stages.ts shares GitHub's answers between the stages that ask at once.
  'pr.fetchHeader': (args) => fetchPrStage('header', args),
  'pr.fetchActivity': (args) => fetchPrStage('activity', args),
  'pr.fetchFiles': (args) => fetchPrStage('files', args),
  'pr.fetchFileDiffs': (args) => fetchFileDiffs(args),
  'pr.fetchThreads': (args) => fetchPrStage('threads', args),
  'pr.fetchMergeBox': (args) => fetchPrStage('mergeBox', args),
  'pr.fetchChecks': (args) => fetchPrStage('checks', args),
  'pr.fetchStack': (args) => fetchPrStage('stack', args),
  'pr.fetchMeta': (args) => fetchPrStage('meta', args),
  'pr.reviewerCandidates': async ({ prId, query }) => {
    const { path } = pullRequestFor(prId);
    const q = query.trim();
    // The picker asks again after every pause in typing; what it asked in the last minute is answered from memory.
    const [available, suggested] = await Promise.all([
      cached(kept.availableReviewers, `${path}?q=${q}`, 60_000, false, () => getJson(`${path}/page_data/reviewers${q ? `?q=${encodeURIComponent(q)}` : ''}`, availableReviewersAnswer)),
      cached(kept.suggestedReviewers, path, 60_000, false, () => getJson(`${path}/page_data/suggested_reviewers`, suggestedReviewersAnswer)),
    ]);
    return reviewerCandidatesFrom(available, suggested, q);
  },
  'pr.proposedMergeCommit': ({ prId, method }) => proposedMergeCommit(pullRequestFor(prId), method),
  'markdown.preview': async ({ text, prId }) => {
    // The fields GitHub's own comment box sends for a comment on a pull request (docs/research/github-web-mutations.md).
    const pull = pullRequestFor(prId);
    return {
      html: await render('/preview', {
        text,
        issue: pull.databaseId,
        repository: pull.repositoryDatabaseId,
        project: pull.databaseId,
        subject: String(pull.number),
        subject_type: 'PullRequest',
      }),
    };
  },
  'markdown.emojis': async () => {
    // GitHub's emoji by name, in its order: Unicode's as [image, character], GitHub's own as [image] alone
    // (docs/research/github-web-endpoints.md).
    const emojis = await getJson('/autocomplete/emojis_for_editor', z.record(z.string(), z.union([z.tuple([z.string(), z.string()]), z.tuple([z.string()])])));
    return Object.entries(emojis).map(([name, [imageUrl, character]]) => (character === undefined ? { name, imageUrl } : { name, character }));
  },
  ...mutations,
};


/** Shares one in-flight or fresh load per key of `answers` for `ttlMs`; `force` reloads; failures are not kept. */
function cached<T,>(answers: Map<string, Kept<T>>, key: string, ttlMs: number, force: boolean | undefined, load: () => Promise<T>): Promise<T> {
  const hit = answers.get(key);
  if (!force && hit && hit.expiresAt > Date.now()) return hit.value;
  const value = load();
  answers.set(key, { expiresAt: Date.now() + ttlMs, value });
  value.catch(() => {
    if (answers.get(key)?.value === value) answers.delete(key);
  });
  return value;
}

interface Kept<T> {
  expiresAt: number;
  value: Promise<T>;
}

/** What `cached` keeps, a map for each kind of answer: `pr.fetch`'s pull requests and the reviewer picker's two lists. */
const kept = {
  pullRequests: new Map<string, Kept<PrDetail>>(),
  availableReviewers: new Map<string, Kept<z.infer<typeof availableReviewersAnswer>>>(),
  suggestedReviewers: new Map<string, Kept<z.infer<typeof suggestedReviewersAnswer>>>(),
};
