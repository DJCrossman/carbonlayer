// Imported first by the script that runs in Graphite's own page (entrypoints/graphite-sections.content.ts). Where zod
// compiles parsers with `new Function` (its classic API's objects do; zod/mini's never do), its first schema checks
// whether it may, and where the page's CSP forbids eval that check is a violation the page reports to its own server, on
// every page load. Parsing without compiling never checks.
import { z } from 'zod/mini';

z.config({ jitless: true });
