/**
 * The statistics: the three unit trays under the galaxy and the whole Charts tab.
 *
 * Each tray fills one cell of the bottom row; ChartsView fills the work area beside the rail.
 * All four read the report and the shared selection from the store, so the shell only has to
 * mount them.
 */

export { LanguageTray } from "./trays/LanguageTray";
export { ActivityTray } from "./trays/ActivityTray";
export { HotspotTray } from "./trays/HotspotTray";
export { ChartsView } from "./ChartsView";
