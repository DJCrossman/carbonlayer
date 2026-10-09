import type { Fixtures } from '../app/data-source';
import { inboxFixtures } from './inbox';
import { prFixtures } from './pr';

export const fixtures: Fixtures = { inbox: inboxFixtures, prs: prFixtures, login: 'octocat' };
