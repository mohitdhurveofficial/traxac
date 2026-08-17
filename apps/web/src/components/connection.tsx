import { onlineManager } from "@tanstack/react-query";
import { useEffect, useState } from "react";

/** Tracks the browser's connectivity, via the same signal React Query uses. */
export function useIsOnline(): boolean {
  const [online, setOnline] = useState(() => onlineManager.isOnline());
  useEffect(() => onlineManager.subscribe(setOnline), []);
  return online;
}

/**
 * Standing notice while the connection is down.
 *
 * React Query pauses mutations when the browser goes offline and replays them
 * on reconnect. That is the right behaviour — a half-typed invoice should not
 * be lost to a dropped signal — but without this bar the Save button simply
 * appears to do nothing, which is the worst possible reading of it.
 */
export function ConnectionBanner() {
  const online = useIsOnline();
  if (online) return null;
  return (
    <div
      role="status"
      className="no-print sticky top-0 z-[80] bg-amber-500 px-4 py-1.5 text-center text-xs font-medium text-white"
    >
      You are offline. Anything you save now will go through when the connection returns.
    </div>
  );
}
