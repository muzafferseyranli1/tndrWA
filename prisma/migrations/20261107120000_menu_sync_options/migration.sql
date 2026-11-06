-- AlterTable
ALTER TABLE "Product" ADD COLUMN "sourceKey" TEXT;

-- AlterTable
ALTER TABLE "OptionGroup" ADD COLUMN "maxSelect" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN "optionsWanted" BOOLEAN;

-- AlterTable
ALTER TABLE "OrderItemOption" ADD COLUMN "complete" BOOLEAN NOT NULL DEFAULT true;
