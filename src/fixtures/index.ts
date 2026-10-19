import type { Fixtures } from '../app/data-source';
import { inboxFixtures, inboxPageFixtures } from './inbox';
import { fileContentsAtHead, prFixtures } from './pr';

export const fixtures: Fixtures = { inbox: inboxFixtures, inboxPages: inboxPageFixtures, prs: prFixtures, fileContents: fileContentsAtHead };
