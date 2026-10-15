// Imported first by every script that reads by zod's schemas, and by the tests (vitest.config.ts). zod/mini comes
// without messages: until a locale is loaded, every issue reads "Invalid input". With English, what fails says what it
// expected and what it found ("expected string, received number"), as zod's classic API did, in the errors the pages
// show and the console.
import { z } from 'zod/mini';

z.config(z.locales.en());
