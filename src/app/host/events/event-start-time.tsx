"use client";

import { useBrowserTimeZone } from "@/lib/time/browser-time";

export default function EventStartTime({ startAt }: { startAt: string }) {
  const timeZone = useBrowserTimeZone();
  const dateFormat = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium", timeStyle: "short", timeZone,
  });

  return <time dateTime={startAt}>{dateFormat.format(new Date(startAt))}</time>;
}
