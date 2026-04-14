-- AlterTable
ALTER TABLE "User"
ADD COLUMN "phoneNumber" TEXT,
ADD COLUMN "phoneVerified" BOOLEAN NOT NULL DEFAULT false;

-- Backfill placeholders for existing rows before adding NOT NULL + UNIQUE.
WITH numbered_users AS (
  SELECT "id", ROW_NUMBER() OVER (ORDER BY "createdAt", "id") AS row_no
  FROM "User"
  WHERE "phoneNumber" IS NULL
)
UPDATE "User" u
SET "phoneNumber" = CONCAT('+1999', LPAD(numbered_users.row_no::text, 10, '0'))
FROM numbered_users
WHERE u."id" = numbered_users."id";

-- Enforce required unique phone number.
ALTER TABLE "User"
ALTER COLUMN "phoneNumber" SET NOT NULL;

CREATE UNIQUE INDEX "User_phoneNumber_key" ON "User"("phoneNumber");
