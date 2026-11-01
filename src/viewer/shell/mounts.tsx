/**
 * The other builders' views, mounted through one module so the shell has a single seam to them:
 * the galaxy plate (galaxy/) and the trays and Charts tab (charts/). If either contract changes,
 * this is the one file the shell has to touch.
 */

export { ActivityTray, ChartsView, HotspotTray, LanguageTray } from "../charts";
export { GalaxyView } from "../galaxy/GalaxyView";
