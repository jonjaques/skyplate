import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const elem = document.getElementById("root")!;
const app = (
  <StrictMode>
    <App />
  </StrictMode>
);

// In development, Bun's hot reload re-runs this module; keeping the root on import.meta.hot
// stops it from mounting a second React root on the same element. Bun only allows
// `import.meta.hot.data` spelled out in full (it rewrites it statically), so no alias. The
// production bundle has no import.meta.hot and takes the plain path.
type HotData = { root?: Root };
if (import.meta.hot) ((import.meta.hot.data as HotData).root ??= createRoot(elem)).render(app);
else createRoot(elem).render(app);
