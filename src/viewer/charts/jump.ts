/**
 * Opening the Charts tab at one section, from a tray under the galaxy.
 *
 * The Charts tab unmounts while another tab is showing, so there is no element to scroll to
 * at the moment a tray is clicked. The request waits here and ChartsView takes it once, as it
 * mounts. A store field would outlive the jump and scroll the tab again on every later visit.
 */

import { useViewer } from "../state/store";

export type ChartsSection = "composition" | "history" | "risk" | "structure" | "people" | "coupling" | "code";

let pending: ChartsSection | null = null;

export function openChartsAt(section: ChartsSection) {
  pending = section;
  useViewer.getState().setTab("charts");
}

export function takePendingSection(): ChartsSection | null {
  const section = pending;
  pending = null;
  return section;
}
