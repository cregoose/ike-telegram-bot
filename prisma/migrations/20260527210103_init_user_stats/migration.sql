/*
  Warnings:

  - You are about to drop the column `maxCharsAllTime` on the `user` table. All the data in the column will be lost.
  - You are about to drop the column `maxCharsMonth` on the `user` table. All the data in the column will be lost.
  - You are about to drop the column `maxCharsWeek` on the `user` table. All the data in the column will be lost.
  - You are about to drop the column `totalPosts` on the `user` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `user` DROP COLUMN `maxCharsAllTime`,
    DROP COLUMN `maxCharsMonth`,
    DROP COLUMN `maxCharsWeek`,
    DROP COLUMN `totalPosts`;

-- CreateTable
CREATE TABLE `UserStats` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `chatId` BIGINT NOT NULL,
    `totalPosts` INTEGER NOT NULL DEFAULT 0,
    `maxCharsWeek` INTEGER NOT NULL DEFAULT 0,
    `maxCharsMonth` INTEGER NOT NULL DEFAULT 0,
    `maxCharsAllTime` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `UserStats_userId_chatId_key`(`userId`, `chatId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `UserStats` ADD CONSTRAINT `UserStats_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
