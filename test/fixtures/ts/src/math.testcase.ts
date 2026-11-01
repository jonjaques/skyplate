import { add, Color } from "./math";
import { square } from "./legacy";

export function checkAdd(): boolean {
  return add(1, 2) === 3 && square(2) === 4 && Color.Red === 0;
}
