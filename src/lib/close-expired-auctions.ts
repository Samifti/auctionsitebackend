import { AuctionStatus } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type { Server } from "socket.io";

/**
 * Marks past-due ACTIVE auctions as ENDED and sets the winner to the highest bidder.
 */
export async function closeExpiredAuctions(prisma: PrismaClient, io: Server): Promise<number> {
  const now = new Date();
  const expired = await prisma.property.findMany({
    where: { status: AuctionStatus.ACTIVE, auctionEnd: { lt: now } },
    select: { id: true },
  });

  let closed = 0;
  for (const row of expired) {
    const topBid = await prisma.bid.findFirst({
      where: { propertyId: row.id },
      orderBy: { amount: "desc" },
      include: { user: { select: { name: true } } },
    });

    await prisma.property.update({
      where: { id: row.id },
      data: {
        status: AuctionStatus.ENDED,
        winnerUserId: topBid?.userId ?? null,
      },
    });

    io.to(`property:${row.id}`).emit("auction:closed", {
      propertyId: row.id,
      status: AuctionStatus.ENDED,
      winnerUserId: topBid?.userId ?? null,
      winningAmount: topBid?.amount ?? null,
      winnerName: topBid?.user.name ?? null,
    });
    closed += 1;
  }

  return closed;
}
