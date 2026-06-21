CREATE TYPE "MarketingSubscriberStatus" AS ENUM ('subscribed', 'unsubscribed');

CREATE TABLE "MarketingSubscriber" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "status" "MarketingSubscriberStatus" NOT NULL DEFAULT 'subscribed',
    "source" TEXT NOT NULL DEFAULT 'storefront_coupon',
    "couponCode" TEXT NOT NULL,
    "unsubscribeToken" TEXT NOT NULL,
    "consentedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unsubscribedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingSubscriber_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MarketingSubscriber_email_key" ON "MarketingSubscriber"("email");
CREATE UNIQUE INDEX "MarketingSubscriber_unsubscribeToken_key" ON "MarketingSubscriber"("unsubscribeToken");

