"use client";

import { useEffect, useState } from "react";

/**
 * A `Date` that re-renders its consumers every `intervalMs` — used by
 * the inbox list's status line (red "esperando há Xmin", amber "janela
 * fecha em Xh") so elapsed/remaining times tick forward on their own
 * instead of only updating on the next data refetch.
 */
export function useNow(intervalMs: number = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
