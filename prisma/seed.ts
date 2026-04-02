import bcrypt from "bcryptjs";
import { PrismaClient, AuctionStatus, Role } from "@prisma/client";

import { seedImageTemplates, seedProperties } from "./seed-properties";

const prisma = new PrismaClient();

function bidAmountSequence(startingPrice: number, currentPrice: number, minimumIncrement: number): number[] {
  if (currentPrice <= startingPrice) {
    return [];
  }
  const amounts: number[] = [];
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

  const passwordHash = await bcrypt.hash("Password123!", 10);

  const admin = await prisma.user.create({
    data: {
      name: "Admin User",
      email: "admin@auction.local",
      passwordHash,
      role: Role.ADMIN,
    },
  });

  const customers = await Promise.all(
    ["fatima", "omar", "layla"].map((name) =>
      prisma.user.create({
        data: {
          name: `${name[0].toUpperCase()}${name.slice(1)}`,
          email: `${name}@auction.local`,
          passwordHash,
          role: Role.CUSTOMER,
        },
      }),
    ),
  );

  const properties = seedProperties();

  for (const [index, property] of properties.entries()) {
    const created = await prisma.property.create({
      data: {
        ...property,
        images: seedImageTemplates.map((image, imageIndex) => `${image}&sig=${index}-${imageIndex}`),
        createdById: admin.id,
      },
    });

    if (property.status === AuctionStatus.ACTIVE) {
      const bidAmounts = bidAmountSequence(
        property.startingPrice,
        property.currentPrice,
        property.minimumIncrement,
      );

      for (const [bidIndex, amount] of bidAmounts.entries()) {
        await prisma.bid.create({
          data: {
            amount,
            userId: customers[bidIndex % customers.length].id,
            propertyId: created.id,
            status: bidIndex === bidAmounts.length - 1 ? "ACTIVE" : "OUTBID",
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
