// Read by app.html's first script (entrypoints/app-theme.ts), which holds up the page's parsing and first paint, as well
// as by the app: so this module imports nothing.

/**
 * The theme the github.com page opened the app's frame in (`app.html?theme=`): the one the app will show, the options'
 * theme or else GitHub's, known before the app has loaded or heard from the page. Null when opened directly (harness).
 */
export function themeOpenedIn(): 'light' | 'dark' | null {
  const theme = new URLSearchParams(location.search).get('theme');
  return theme === 'light' || theme === 'dark' ? theme : null;
}
