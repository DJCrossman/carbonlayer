// app.html's first script, a classic one in its <head>: it runs before the page is parsed or painted and puts the page
// in the theme the github.com page opened the frame in, so its first frame is not the light default (a white flash on
// GitHub's dark theme) while the app's code loads. The app keeps that theme from there (main.tsx). A file of its own:
// the extension's CSP blocks inline scripts.
import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { themeOpenedIn } from '../src/app/frame-theme';

export default defineUnlistedScript(() => {
  const theme = themeOpenedIn();
  if (theme) document.documentElement.dataset.theme = theme;
});
