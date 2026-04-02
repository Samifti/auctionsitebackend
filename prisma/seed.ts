import bcrypt from "bcryptjs";
import { addHours, subHours } from "date-fns";
import { PrismaClient, AuctionStatus, Role } from "@prisma/client";

const prisma = new PrismaClient();

const images = [
  "https://images.unsplash.com/photo-1460317442991-0ec209397118?auto=format&fit=crop&w=1200&q=80",
  "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=1200&q=80",
  "https://images.unsplash.com/photo-1494526585095-c41746248156?auto=format&fit=crop&w=1200&q=80",
];

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

  const properties = [
    {
      title: "Palm Jumeirah Waterfront Villa",
      description: "Contemporary six-bedroom villa with private beach access and panoramic Gulf views.",
      propertyType: "Villa",
      location: "Palm Jumeirah, Dubai",
      city: "Dubai",
      area: 7820,
      bedrooms: 6,
      bathrooms: 7,
      amenities: ["Private Beach", "Infinity Pool", "Smart Home", "Covered Parking"],
      startingPrice: 12500000,
      currentPrice: 14250000,
      minimumIncrement: 50000,
      auctionStart: subHours(new Date(), 10),
      auctionEnd: addHours(new Date(), 6),
      status: AuctionStatus.ACTIVE,
      latitude: 25.1124,
      longitude: 55.139,
    },
    {
      title: "Downtown Skyline Apartment",
      description: "Three-bedroom apartment in Downtown with Burj Khalifa views and concierge access.",
      propertyType: "Apartment",
      location: "Downtown Dubai, Dubai",
      city: "Dubai",
      area: 2180,
      bedrooms: 3,
      bathrooms: 4,
      amenities: ["Gym", "Pool", "Concierge", "Balcony"],
      startingPrice: 3200000,
      currentPrice: 3750000,
      minimumIncrement: 25000,
      auctionStart: subHours(new Date(), 7),
      auctionEnd: addHours(new Date(), 8),
      status: AuctionStatus.ACTIVE,
      latitude: 25.1972,
      longitude: 55.2744,
    },
    {
      title: "Sharjah Corporate Office Floor",
      description: "Full office floor with private reception and meeting suites in a grade-A tower.",
      propertyType: "Office",
      location: "Al Majaz 2, Sharjah",
      city: "Sharjah",
      area: 7613,
      bedrooms: null,
      bathrooms: 4,
      amenities: ["Meeting Rooms", "Reception", "Pantry", "Parking"],
      startingPrice: 3100000,
      currentPrice: 3475000,
      minimumIncrement: 10000,
      auctionStart: subHours(new Date(), 4),
      auctionEnd: addHours(new Date(), 4),
      status: AuctionStatus.ACTIVE,
      latitude: 25.3374,
      longitude: 55.3773,
    },
    {
      title: "Aljada Family Townhouse",
      description: "Four-bedroom townhouse with landscaped courtyard and direct access to schools and retail.",
      propertyType: "Townhouse",
      location: "Aljada, Sharjah",
      city: "Sharjah",
      area: 2940,
      bedrooms: 4,
      bathrooms: 5,
      amenities: ["Courtyard", "Maid Room", "Community Park", "Garage"],
      startingPrice: 1450000,
      currentPrice: 1450000,
      minimumIncrement: 10000,
      auctionStart: addHours(new Date(), 12),
      auctionEnd: addHours(new Date(), 36),
      status: AuctionStatus.UPCOMING,
      latitude: 25.3073,
      longitude: 55.4707,
    },
  ];

  for (const [index, property] of properties.entries()) {
    const created = await prisma.property.create({
      data: {
        ...property,
        images: images.map((image, imageIndex) => `${image}&sig=${index}-${imageIndex}`),
        createdById: admin.id,
      },
    });

    if (property.status === AuctionStatus.ACTIVE) {
      const bidAmounts = [
        property.startingPrice + property.minimumIncrement,
        property.currentPrice - property.minimumIncrement,
        property.currentPrice,
      ].filter((value) => value > property.startingPrice);

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
