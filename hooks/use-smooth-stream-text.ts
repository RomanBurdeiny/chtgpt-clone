"use client";

import { useEffect, useRef, useState } from "react";

/**
 * While `streaming` is true, reveals `target` in small steps each animation frame
 * so bursty token deltas feel closer to typing. When `streaming` is false, returns `target` unchanged.
 */
export function useSmoothStreamText(target: string, streaming: boolean): string {
  const [visible, setVisible] = useState("");
  const targetRef = useRef(target);
  targetRef.current = target;

  useEffect(() => {
    if (!streaming) {
      setVisible(target);
      return;
    }

    if (target.length === 0) {
      setVisible("");
    }

    let raf = 0;
    let stopped = false;

    const stepChars = (lag: number) => {
      if (lag <= 0) return 0;
      if (lag <= 4) return 1;
      if (lag <= 24) return 2;
      if (lag <= 80) return Math.min(lag, 4);
      return Math.min(lag, Math.max(5, Math.ceil(lag / 18)));
    };

    const tick = () => {
      if (stopped) return;
      const t = targetRef.current;
      setVisible((prev) => {
        if (prev.length >= t.length) return prev;
        const lag = t.length - prev.length;
        const n = stepChars(lag);
        return t.slice(0, prev.length + n);
      });
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
    };
  }, [streaming]);

  useEffect(() => {
    if (streaming && target.length === 0) {
      setVisible("");
    }
  }, [streaming, target.length]);

  return streaming ? visible : target;
}
