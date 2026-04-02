import { format, subDays } from "date-fns";

import type { PrismaClient } from "@prisma/client";

/**
 * Matches the previous seven 24h windows from `anchor` (same boundaries as sequential bid.count calls).
 * One query instead of seven round-trips.
 */
export async function getBidsByDayWindowCounts(
  prisma: PrismaClient,
  anchor: Date,
): Promise<{ day: string; bids: number }[]> {
  const windows = Array.from({ length: 7 }, (_, index) => ({
    start: subDays(anchor, 6 - index),
    end: subDays(anchor, 5 - index),
    label: format(subDays(anchor, 6 - index), "EEE"),
  }));

  const globalMin = windows[0].start;
  const globalMax = windows[6].end;

  const [row] = await prisma.$queryRaw<
    [
      {
        c0: number;
        c1: number;
        c2: number;
        c3: number;
        c4: number;
        c5: number;
        c6: number;
      },
    ]
  >`
    SELECT
      CAST(COUNT(*) FILTER (WHERE "createdAt" >= ${windows[0].start} AND "createdAt" < ${windows[0].end}) AS int) AS "c0",
      CAST(COUNT(*) FILTER (WHERE "createdAt" >= ${windows[1].start} AND "createdAt" < ${windows[1].end}) AS int) AS "c1",
      CAST(COUNT(*) FILTER (WHERE "createdAt" >= ${windows[2].start} AND "createdAt" < ${windows[2].end}) AS int) AS "c2",
      CAST(COUNT(*) FILTER (WHERE "createdAt" >= ${windows[3].start} AND "createdAt" < ${windows[3].end}) AS int) AS "c3",
      CAST(COUNT(*) FILTER (WHERE "createdAt" >= ${windows[4].start} AND "createdAt" < ${windows[4].end}) AS int) AS "c4",
      CAST(COUNT(*) FILTER (WHERE "createdAt" >= ${windows[5].start} AND "createdAt" < ${windows[5].end}) AS int) AS "c5",
      CAST(COUNT(*) FILTER (WHERE "createdAt" >= ${windows[6].start} AND "createdAt" < ${windows[6].end}) AS int) AS "c6"
    FROM "Bid"
    WHERE "createdAt" >= ${globalMin} AND "createdAt" < ${globalMax}
  `;

  if (!row) {
    return windows.map((w) => ({ day: w.label, bids: 0 }));
  }

  const counts = [row.c0, row.c1, row.c2, row.c3, row.c4, row.c5, row.c6];
  return windows.map((w, i) => ({ day: w.label, bids: counts[i] ?? 0 }));
}
