"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const client_1 = require("@prisma/client");
const seed_properties_1 = require("./seed-properties");
const prisma = new client_1.PrismaClient();
function bidAmountSequence(startingPrice, currentPrice, minimumIncrement) {
    if (currentPrice <= startingPrice) {
        return [];
    }
    const amounts = [];
    let next = startingPrice + minimumIncrement;
    while (next < currentPrice) {
        amounts.push(next);
        next += minimumIncrement;
    }
    amounts.push(currentPrice);
    return amounts;
}
async function main() {
    await prisma.bid.deleteMany();
    await prisma.property.deleteMany();
    await prisma.user.deleteMany();
    const passwordHash = await bcryptjs_1.default.hash("Password123!", 10);
    const admin = await prisma.user.create({
        data: {
            name: "Admin User",
            email: "admin@auction.local",
            passwordHash,
            role: client_1.Role.ADMIN,
            emailVerified: true,
        },
    });
    const customers = await Promise.all(["fatima", "omar", "layla"].map((name) => prisma.user.create({
        data: {
            name: `${name[0].toUpperCase()}${name.slice(1)}`,
            email: `${name}@auction.local`,
            passwordHash,
            role: client_1.Role.CUSTOMER,
            emailVerified: true,
        },
    })));
    const properties = (0, seed_properties_1.seedProperties)();
    for (const [index, property] of properties.entries()) {
        const created = await prisma.property.create({
            data: {
                ...property,
                images: seed_properties_1.seedImageTemplates.map((image, imageIndex) => `${image}&sig=${index}-${imageIndex}`),
                createdById: admin.id,
            },
        });
        if (property.status === client_1.AuctionStatus.ACTIVE) {
            const bidAmounts = bidAmountSequence(property.startingPrice, property.currentPrice, property.minimumIncrement);
            for (const [bidIndex, amount] of bidAmounts.entries()) {
                await prisma.bid.create({
                    data: {
                        amount,
                        userId: customers[bidIndex % customers.length].id,
                        propertyId: created.id,
                        status: bidIndex === bidAmounts.length - 1 ? client_1.BidStatus.ACTIVE : client_1.BidStatus.OUTBID,
                    },
                });
            }
            await prisma.property.update({
                where: { id: created.id },
                data: { bidCount: bidAmounts.length },
            });
        }
    }
}
main()
    .then(async () => {
    await prisma.$disconnect();
})
    .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
});
