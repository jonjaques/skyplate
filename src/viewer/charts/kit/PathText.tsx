/**
 * Repository paths in charts use the shell's PathText, which truncates the directories and
 * keeps the file name: "apps/game/sr…/GameEngine.ts".
 *
 * The charts kit used to carry its own, a right-to-left box that ate the start of the path
 * instead ("…/engine/GameEngine.ts"). With both in use, the same file read differently in the
 * hotspot tray than in the explorer and the record beside it. The shell's version also keeps
 * the top-level directory, which names the region the file belongs to.
 */

export { PathText } from "../../shell/parts";
