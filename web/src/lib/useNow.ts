"use client";

import { useEffect, useState } from "react";

/** Current unix time in seconds, ticking. Starts at 0 on the server / first render to stay hydration-safe. */
export function useNow(intervalMs = 15_000): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Math.floor(Date.now() / 1000));
    tick();
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
