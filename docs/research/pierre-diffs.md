# @pierre/diffs 1.5.2 — findings for a WXT extension

Sources: the shipped `dist/*.d.ts` and `dist/*.js`, the docs source in github.com/pierrecomputer/pierre
(`apps/docs/app/(diffs)/docs/*`), the README. The §7 snippet type-checks under `tsc --strict`; parser
behaviour was traced in source, not executed.

## Three problems for a GitHub content script (why the app lives in an iframe)
1. **Import crashes in an isolated-world content script.** `dist/components/web-components.js` (a listed
   side effect, pulled in by every React component) runs `customElements.get("diffs-container")` at module
   top level; `customElements` is `null` in Chrome content scripts (sveltejs/svelte#14739). The core CSS is
   only attached in that element's constructor, so stubbing the registry would also leave it unstyled.
2. **No worker pool on github.com**: GitHub's CSP `worker-src` allows neither `chrome-extension:` nor `blob:`.
   Main-thread highlighting (the default, engine `'shiki-js'`, no WASM) still works.
3. **Bundle size**: WXT bundles content scripts as a single IIFE, so `import { bundledLanguages } from "shiki"`
   inlines every grammar: 11 MB minified. Code-split ESM entry is 729 KB (214 KB gzip) plus 399 lazy chunks.

**Decision:** host the UI in an extension page (`app.html`) embedded with WXT `createIframeUi`. Real
`customElements`, ESM code-splitting, workers allowed, default MV3 CSP.

## 1. Install and import
- Peer deps `react`/`react-dom` ^18.3.1 || ^19. Deps: `shiki ^3||^4`, `diff 9`, `@shikijs/transformers`, `@pierre/theme`, `@pierre/theming`.
- Entry points: `@pierre/diffs` (vanilla + utilities: `parsePatchFiles`, `processFile`, `getSingularPatch`, `parseDiffFromFile`, `setLanguageOverride`, `preloadHighlighter`, `trimPatchContext`); `@pierre/diffs/react` (`FileDiff`, `PatchDiff`, `MultiFileDiff`, `File`, `CodeView`, `UnresolvedFile`, `Virtualizer`, `VirtualizerContext`, `WorkerPoolContextProvider`, `useWorkerPool`); `@pierre/diffs/worker` (`getOrCreateWorkerPoolSingleton`, `terminateWorkerPoolSingleton`); `@pierre/diffs/worker/worker.js` (ES module worker); `@pierre/diffs/worker/worker-portable.js` (classic, ~443 KB).
- **No CSS to import**: styles ship as a JS string adopted into the component's own shadow root.
- Worker pool (optional, iframe page only): `import WorkerUrl from '@pierre/diffs/worker/worker.js?worker&url'; new Worker(WorkerUrl, { type: 'module' })`; may need Vite `worker.format: 'es'` (WXT: `vite: () => ({ worker: { format: 'es' } })`, UNVERIFIED). Wrap in `<WorkerPoolContextProvider poolOptions={{ workerFactory }} highlighterOptions={{ theme, langs }}>`; then `theme`, `lineDiffType`, `tokenizeMaxLineLength`, `useTokenTransformer` come from the pool.

## 2. Parsing GitHub input
- **GitHub REST `patch` (hunks only) is rejected as-is**: `PatchDiff`/`getSingularPatch` throw "must contain exactly 1 file diff"; `processFile(patch)` silently drops the first hunk. **Prepend a git-style header** built from `filename`, `previous_filename`, `status`, then `parsePatchFiles(text)[0].files[0]` (see §7). This sets `name`, `prevName`, `type` (`new` | `deleted` | `rename-changed` | `change`).
- Full multi-file diff: `parsePatchFiles(diffText, cacheKeyPrefix).flatMap(p => p.files)`; signature `parsePatchFiles(data, cacheKeyPrefix?, throwOnError?) : ParsedPatch[]`, `ParsedPatch = { patchMetadata?, files: FileDiffMetadata[] }`.
- Language is inferred from the name; override with `setLanguageOverride(fileDiff, 'tsx')` or `setCustomExtension(ext, lang)`. `FileDiffMetadata.isPartial` is true for patch input. Full contents: `<MultiFileDiff oldFile={{name, contents}} newFile={…}/>` or `parseDiffFromFile(old, new)` (`null` for a missing side).

## 3. Options (`options` prop, `FileDiffOptions` from `@pierre/diffs/react`; keep it referentially stable)
| Option | Values | Default |
|---|---|---|
| `diffStyle` | `'unified' \| 'split'` | `'split'` |
| `overflow` | `'scroll' \| 'wrap'` | `'scroll'` |
| `theme` | Shiki theme name or `{ light, dark }` e.g. `{ light: 'github-light', dark: 'github-dark' }` | pierre themes |
| `themeType` | `'system' \| 'light' \| 'dark'` | `'system'` |
| `diffIndicators` | `'classic' \| 'bars' \| 'none'` | `'bars'` |
| `lineDiffType` | `'word-alt' \| 'word-line' \| 'word' \| 'char' \| 'none'` | `'word-alt'` |
| `hunkSeparators` | `'simple' \| 'metadata' \| 'line-info' \| 'line-info-basic'` | `'line-info'` |
Also `disableFileHeader`, `disableLineNumbers`, `disableBackground`, `stickyHeader`, `unsafeCSS`, `preferredHighlighter`, `collapsed`.
- Highlighting is async on the main thread; `preloadHighlighter({ themes, langs })` warms it.
- Component renders into its own shadow root on `<diffs-container>`; CSS targets `:host`, no `:root` rules. Customise with CSS custom properties (`--diffs-font-family`, `--diffs-font-size`, `--diffs-line-height`, `--diffs-addition-color-override`, …) on a wrapper, or the `style` prop.

## 4. Line UI, expansion, virtualisation, collapsed state
- **Annotations**: `lineAnnotations: DiffLineAnnotation<T>[]` = `{ side: 'deletions'|'additions', lineNumber, metadata: T }` (`lineNumber` is the real file line on that side; `0` for file-level). Render with `renderAnnotation(annotation) => ReactNode` (light-DOM child with `slot="annotation-<side>-<line>"`, React events work). GitHub `RIGHT`→`'additions'`, `LEFT`→`'deletions'`. Annotation shows only if the line is rendered.
- **Add-comment affordance**: `enableGutterUtility: true` + `onGutterUtilityClick(range: SelectedLineRange)` (built-in "+") or React prop `renderGutterUtility(getHoveredLine)`; not both.
- **Line events** in options: `onLineClick`, `onLineNumberClick`, `onLineEnter`, `onLineLeave` → `{ type:'diff-line', annotationSide, lineType, lineNumber, lineElement, numberElement, numberColumn, event }`; `lineHoverHighlight: 'disabled'|'both'|'number'|'line'`.
- **Multi-line selection**: `enableLineSelection` + `onLineSelectionStart/Change/End`, `onLineSelected`; controlled via `selectedLines: { start, side?, end, endSide? }`.
- **Header slots**: `renderHeaderPrefix`, `renderHeaderFilenameSuffix`, `renderHeaderMetadata`, `renderCustomHeader` (each receives `fileDiff`).
- **Collapsed / viewed**: `options.collapsed: true` hides the body, keeps the header. No built-in viewed state — put a checkbox in `renderHeaderMetadata` and toggle `collapsed`.
- **Expanding context** needs `options.loadDiffFiles: async (fileDiff) => ({ oldFile: {name, contents} | null, newFile })`, called lazily on first expand; only for `type` `'change'`/`'rename-changed'`. Options `expansionLineCount` (100), `expandUnchanged`, `collapsedContextThreshold`.
- **Virtualisation**: `<Virtualizer className contentClassName config={{ overscrollSize, intersectionObserverMargin }}>` is its own scroll container; window scrolling needs a `VirtualizerContext.Provider` with a vanilla `Virtualizer`. Or `<CodeView items={[{ id, type:'diff', fileDiff, annotations, collapsed, version }]} renderAnnotation …/>` (virtualised multi-file list, owns its scroll region; fastest path).

## 5. Bundle size / performance
Code-split ESM entry 729 KB min (214 KB gzip) incl. React; 399 lazy chunks (~11.7 MB total, largest grammar ~790 KB). Oniguruma WASM (622 KB) only with `'shiki-wasm'`. No supported way to trim languages. Limits: `tokenizeMaxLineLength` 1000, `tokenizeMaxLength` 100,000, `maxLineDiffLength` 1000. Worker pool is experimental (`poolSize` 8); give diffs a `cacheKey`.

## 6. Non-React build
Vanilla classes `FileDiff`, `File`, `VirtualizedFileDiff`, `VirtualizedFile`, `Virtualizer`, `CodeView`, `FileStream`, `UnresolvedFile`: `new FileDiff(options, workerPool?)` → `.render({ fileDiff, containerWrapper | fileContainer, lineAnnotations })`, `.setLineAnnotations()`, `.setOptions()`, `.expandHunk()`, `.cleanUp()`; `renderAnnotation` returns an `HTMLElement`.

## 7. Snippet (type-checks)
```tsx
import { useMemo } from 'react';
import { parsePatchFiles, type FileDiffMetadata } from '@pierre/diffs';
import { FileDiff, type FileDiffOptions } from '@pierre/diffs/react';

interface GitHubPullFile { filename: string; previous_filename?: string; status: 'added'|'removed'|'modified'|'renamed'|'copied'|'changed'|'unchanged'; patch?: string }
interface Thread { body: string }

export function PullRequestFiles({ files }: { files: GitHubPullFile[] }) {
  const diffs = useMemo(() => files.filter((f) => f.patch != null).map(parseGitHubFile), [files]);
  const options = useMemo((): FileDiffOptions<Thread, undefined> => ({
    diffStyle: 'unified', overflow: 'wrap',
    theme: { light: 'github-light', dark: 'github-dark' }, themeType: 'system',
    enableGutterUtility: true,
    onGutterUtilityClick: (range) => console.log('start comment', range.side, range.start, range.end),
  }), []);
  return diffs.map((fileDiff, index) => (
    <FileDiff<Thread> key={fileDiff.name} fileDiff={fileDiff} options={options}
      lineAnnotations={index === 0 ? [{ side: 'additions', lineNumber: 12, metadata: { body: 'Nit' } }] : []}
      renderAnnotation={(a) => <div style={{ padding: 8 }}>{a.metadata.body}</div>} />
  ));
}

// GitHub's `patch` has no file header; the parser needs one to find the file (and its name/status).
function parseGitHubFile(file: GitHubPullFile): FileDiffMetadata {
  const oldName = file.previous_filename ?? file.filename;
  const header = [`diff --git a/${oldName} b/${file.filename}`];
  if (file.status === 'added') header.push('new file mode 100644', '--- /dev/null', `+++ b/${file.filename}`);
  else if (file.status === 'removed') header.push('deleted file mode 100644', `--- a/${oldName}`, '+++ /dev/null');
  else {
    if (file.status === 'renamed') header.push('similarity index 50%', `rename from ${oldName}`, `rename to ${file.filename}`);
    header.push(`--- a/${oldName}`, `+++ b/${file.filename}`);
  }
  return parsePatchFiles(`${header.join('\n')}\n${file.patch}\n`)[0].files[0];
}
```
Line 12 must fall inside a rendered hunk or the annotation will not show. Run `parseGitHubFile` on a real PR before relying on it.

Extracted package (types) is at the research scratchpad `extracted/package/dist/` — `react/types.d.ts`, `types.d.ts`, `components/FileDiff.d.ts`, `managers/InteractionManager.d.ts`, `utils/parsePatchFiles.js`; the same files are in `node_modules/@pierre/diffs/dist/`.
