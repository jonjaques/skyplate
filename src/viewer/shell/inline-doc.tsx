/**
 * A JSDoc summary rendered as the reader would read it in an editor's hover.
 *
 * The analyzer stores the first sentence of each doc comment as written, and doc comments are
 * Markdown with JSDoc tags: GameEngine's read "the *presentation* layer" with the asterisks
 * showing. Only the inline subset is handled (code, emphasis, strong, links, {@link}), because
 * a one-sentence summary never holds blocks, and anything unrecognized stays literal text
 * rather than being guessed at.
 */

export type DocSpan = { kind: "text" | "code" | "em" | "strong"; text: string };

// Alternatives, in priority order: `code`, **strong** / __strong__, *em* / _em_ (an underscore
// only between non-word characters, so snake_case names survive; a closing marker only after a
// non-space, as in CommonMark, so "2 * 3" is arithmetic), [label](url), and
// {@link Name}, {@link Name label}, {@link Name|label}, {@linkcode Name}, {@linkplain Name}.
const INLINE =
  /`([^`]+)`|\*\*(?=\S)([^*]*?\S)\*\*|(?<!\w)__(?=\S)([^_]*?\S)__(?!\w)|\*(?=[^\s*])([^*]*?[^\s*])\*|(?<!\w)_(?=[^\s_])([^_]*?[^\s_])_(?!\w)|\[([^\]]+)\]\([^)\s]*\)|\{@link(code|plain)?\s+([^\s|}]+)(?:\s*\|\s*|\s+)?([^}]*)\}/g;

/** Split a summary into styled spans. Pure, so it is tested without a DOM. */
export function parseInlineDoc(source: string): DocSpan[] {
  const out: DocSpan[] = [];
  const push = (kind: DocSpan["kind"], text: string) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.kind === kind && kind === "text") last.text += text;
    else out.push({ kind, text });
  };
  let at = 0;
  for (const m of source.matchAll(INLINE)) {
    push("text", source.slice(at, m.index));
    at = m.index + m[0].length;
    if (m[1] !== undefined) push("code", m[1]);
    else if (m[2] !== undefined || m[3] !== undefined) push("strong", (m[2] ?? m[3])!);
    else if (m[4] !== undefined || m[5] !== undefined) push("em", (m[4] ?? m[5])!);
    else if (m[6] !== undefined) push("text", m[6]);
    else if (m[8] !== undefined) {
      const label = m[9]?.trim();
      // {@linkplain} and a labeled link read as prose; a bare {@link Name} names code.
      if (label) push("text", label);
      else push(m[7] === "plain" ? "text" : "code", m[8]);
    }
  }
  push("text", source.slice(at));
  return out;
}

/** `italic`: the summary around it is set in italic, so emphasis inside it turns upright. */
export function InlineDoc({ text, italic = false }: { text: string; italic?: boolean }) {
  return (
    <>
      {parseInlineDoc(text).map((span, i) =>
        span.kind === "code" ? (
          <code key={i} className="font-mono text-[0.92em] not-italic [font-variant-ligatures:none]">
            {span.text}
          </code>
        ) : span.kind === "strong" ? (
          <strong key={i} className="font-semibold">
            {span.text}
          </strong>
        ) : span.kind === "em" ? (
          <em key={i} className={italic ? "not-italic" : "italic"}>
            {span.text}
          </em>
        ) : (
          <span key={i}>{span.text}</span>
        ),
      )}
    </>
  );
}
