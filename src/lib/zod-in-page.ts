// Imported first by the script that runs in Graphite's own page (entrypoints/graphite-sections.content.ts). The first
// schema zod makes checks whether it may compile parsers with `new Function`, and where the page's CSP forbids eval that
// check is a violation the page reports to its own server, on every page load. Parsing without compiling never checks.
import { z } from 'zod';

z.config({ jitless: true });
