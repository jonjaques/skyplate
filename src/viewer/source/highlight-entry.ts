/**
 * Entry for assets/highlight.js, the lazily loaded classic script build.ts writes beside the
 * app bundle. It only hands the library to the viewer; see source/highlight.ts for why it is a
 * separate script and how the viewer loads it.
 */

import hljs from "highlight.js";

window.__starchartHighlight = hljs;
