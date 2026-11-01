import { describe, expect, test } from "bun:test";
import { parseInlineDoc } from "../src/viewer/shell/inline-doc";

describe("JSDoc summary rendering", () => {
  test("emphasis, strong and code lose their markers", () => {
    expect(parseInlineDoc("Owns the *presentation* layer, **not** the `World`.")).toEqual([
      { kind: "text", text: "Owns the " },
      { kind: "em", text: "presentation" },
      { kind: "text", text: " layer, " },
      { kind: "strong", text: "not" },
      { kind: "text", text: " the " },
      { kind: "code", text: "World" },
      { kind: "text", text: "." },
    ]);
  });

  test("links keep their label; {@link} names code unless it carries a label", () => {
    expect(parseInlineDoc("See [the guide](https://x.dev/g) and {@link SaveStore.read}.")).toEqual([
      { kind: "text", text: "See the guide and " },
      { kind: "code", text: "SaveStore.read" },
      { kind: "text", text: "." },
    ]);
    expect(parseInlineDoc("Uses {@link Clock | the clock} and {@linkplain Foo}.")).toEqual([
      { kind: "text", text: "Uses the clock and Foo." },
    ]);
  });

  test("snake_case, lone asterisks and plain text stay literal", () => {
    expect(parseInlineDoc("Reads max_depth_limit from a*b and 2 * 3.")).toEqual([
      { kind: "text", text: "Reads max_depth_limit from a*b and 2 * 3." },
    ]);
    expect(parseInlineDoc("")).toEqual([]);
  });
});
