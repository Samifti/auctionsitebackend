"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.closeExpiredAuctions = closeExpiredAuctions;
const client_1 = require("@prisma/client");
const logger_1 = require("./logger");
/**
 * Marks past-due ACTIVE auctions as ENDED and sets the winner to the highest bidder.
 */
async function closeExpiredAuctions(prisma, io) {
    const now = new Date();
    const expired = await prisma.property.findMany({
        where: { status: client_1.AuctionStatus.ACTIVE, auctionEnd: { lt: now } },
        select: { id: true, title: true },
    });
    let closed = 0;
    for (const row of expired) {
        try {
            // Use transaction to prevent race conditions
            const result = await prisma.$transaction(async (tx) => {
                // Double-check the property is still active and expired
                const property = await tx.property.findUnique({
                    where: { id: row.id },
                    select: { id: true, status: true, auctionEnd: true },
                });
                if (!property || property.status !== client_1.AuctionStatus.ACTIVE || property.auctionEnd >= now) {
                    return null; // Already closed or extended
                }
                const topBid = await tx.bid.findFirst({
                    where: { propertyId: row.id },
                    orderBy: { amount: "desc" },
                    include: { user: { select: { name: true } } },
                });
                // Update property status atomically
                const updated = await tx.property.updateMany({
                    where: {
                        id: row.id,
                        status: client_1.AuctionStatus.ACTIVE, // Only update if still active
                    },
                    data: {
                        status: client_1.AuctionStatus.ENDED,
                        winnerUserId: topBid?.userId ?? null,
                    },
                });
                if (updated.count === 0) {
                    return null; // Property was already updated
                }
                return { topBid, title: row.title };
            });
            if (!result) {
                continue; // Skip if already processed
            }
            // Create notification outside transaction to avoid blocking
            if (result.topBid?.userId) {
                await prisma.notification
                    .create({
                    data: {
                        userId: result.topBid.userId,
                        type: client_1.NotificationType.AUCTION_WON,
                        title: "You won an auction",
                        body: `You are the high bidder on "${result.title}".`,
                        propertyId: row.id,
                    },
                })
                    .catch((err) => logger_1.logger.error("notify_winner_expired_failed", { propertyId: row.id, error: err }));
            }
            // Emit socket event
            io.to(`property:${row.id}`).emit("auction:closed", {
                propertyId: row.id,
                status: client_1.AuctionStatus.ENDED,
                winnerUserId: result.topBid?.userId ?? null,
                winningAmount: result.topBid?.amount ?? null,
                winnerName: result.topBid?.user.name ?? null,
            });
            closed += 1;
            logger_1.logger.info("auction_closed_expired", {
                propertyId: row.id,
                winnerUserId: result.topBid?.userId,
                winningAmount: result.topBid?.amount,
            });
        }
        catch (error) {
            logger_1.logger.error("close_expired_auction_failed", { propertyId: row.id, error });
        }
    }
    if (closed > 0) {
        logger_1.logger.info("closed_expired_auctions", { count: closed });
    }
    return closed;
}
