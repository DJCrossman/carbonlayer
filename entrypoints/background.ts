// The service worker has no data role: GitHub is reached from the content script with the user's
// github.com session (src/lib/github-web/). Kept because MV3 extensions conventionally ship one.
export default defineBackground(() => {});
