import { useLayoutEffect, useRef, useState } from "react";

/**
 * Size of an element, kept current with a ResizeObserver. Charts lay out in pixels (so marks
 * stay crisp and bars keep their 24px cap at any width) and need the real box, not a viewBox
 * that would scale hairlines and text along with the plot.
 */
export function useMeasure<T extends HTMLElement>(): [React.RefObject<T | null>, number, number] {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = (w: number, h: number) => {
      // Integer sizes: sub-pixel jitter from a parent's transition would otherwise re-layout
      // every chart on every frame.
      const next = { w: Math.floor(w), h: Math.floor(h) };
      setSize((prev) => (prev.w === next.w && prev.h === next.h ? prev : next));
    };
    const box = el.getBoundingClientRect();
    read(box.width, box.height);
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) read(r.width, r.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size.w, size.h];
}
