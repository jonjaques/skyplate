/**
 * The other builders' views, mounted through one module so the shell has a single seam to them.
 *
 * TEMPORARY: src/viewer/galaxy/GalaxyView.tsx does not exist yet, so the plate is a quiet
 * stand-in with the same contract (fills its parent). Replace the stand-in with
 *   export { GalaxyView } from "../galaxy/GalaxyView";
 * once that file lands.
 */

export { ActivityTray, ChartsView, HotspotTray, LanguageTray } from "../charts";

export function GalaxyView(_props: { compact?: boolean }) {
  return <div className="absolute inset-0 bg-plate" aria-hidden />;
}
