"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBidsByDayWindowCounts = getBidsByDayWindowCounts;
const date_fns_1 = require("date-fns");
/**
 * Matches the previous seven 24h windows from `anchor` (same boundaries as sequential bid.count calls).
 * One query instead of seven round-trips.
 */
async function getBidsByDayWindowCounts(prisma, anchor) {
    const windows = Array.from({ length: 7 }, (_, index) => ({
        start: (0, date_fns_1.subDays)(anchor, 6 - index),
        end: (0, date_fns_1.subDays)(anchor, 5 - index),
        label: (0, date_fns_1.format)((0, date_fns_1.subDays)(anchor, 6 - index), "EEE"),
    }));
    const globalMin = windows[0].start;
    const globalMax = windows[6].end;
    const [row] = await prisma.$queryRaw `
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
