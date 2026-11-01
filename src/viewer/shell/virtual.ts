/**
 * Fixed-height row virtualization for the explorer's tables.
 *
 * A 50k-row table in the DOM costs seconds to lay out and megabytes of nodes; only the rows in
 * view plus an overscan are rendered, between two spacer rows that keep the scroll extent
 * honest. Rows are a fixed height (the explorer never wraps), so offsets are arithmetic.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export function useVirtualRows(count: number, rowHeight: number, headerHeight: number, overscan = 10) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState({ top: 0, height: 600 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setView({ top: el.scrollTop, height: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const raf = useRef(0);
  const onScroll = useCallback(() => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const el = ref.current;
      if (el) setView((v) => (v.top === el.scrollTop ? v : { ...v, top: el.scrollTop }));
    });
  }, []);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const bodyTop = Math.max(0, view.top - headerHeight);
  const start = Math.max(0, Math.floor(bodyTop / rowHeight) - overscan);
  const end = Math.min(count, Math.ceil((bodyTop + view.height) / rowHeight) + overscan);

  /** Scroll just enough to show row i (keyboard navigation). */
  const reveal = useCallback(
    (i: number) => {
      const el = ref.current;
      if (!el) return;
      const top = headerHeight + i * rowHeight;
      if (top < el.scrollTop + headerHeight) el.scrollTop = top - headerHeight;
      else if (top + rowHeight > el.scrollTop + el.clientHeight) el.scrollTop = top + rowHeight - el.clientHeight;
    },
    [rowHeight, headerHeight],
  );

  return { ref, onScroll, start, end, padTop: start * rowHeight, padBottom: (count - end) * rowHeight, reveal };
}
