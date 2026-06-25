-- CreateTable
CREATE TABLE "chat_messages" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "poolId" TEXT,
    "userId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "nonce" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chat_messages_poolId_matchId_createdAt_idx" ON "chat_messages"("poolId", "matchId", "createdAt");

-- CreateIndex
CREATE INDEX "chat_messages_matchId_createdAt_idx" ON "chat_messages"("matchId", "createdAt");

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "pools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
