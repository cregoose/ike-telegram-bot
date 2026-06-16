import { Bot } from "grammy";
import { prisma } from "../database/prisma";

export function setupChatMemberHandler(bot: Bot) {
    // Слушаем изменения статуса участников в чатах
    bot.on("chat_member", async (ctx) => {
        const chatId = ctx.chat.id;
        const userId = ctx.chatMember.new_chat_member.user.id;
        const newStatus = ctx.chatMember.new_chat_member.status;
        const oldStatus = ctx.chatMember.old_chat_member.status;

        if (ctx.chat.type === "private") return;

        // Статусы, означающие, что человека нет в группе
        const leftStatuses = ["left", "kicked"];
        // Статусы, означающие, что человек внутри группы
        const joinedStatuses = ["member", "administrator", "creator"];

        const isLeaving = leftStatuses.includes(newStatus);
        const isJoining = joinedStatuses.includes(newStatus) && leftStatuses.includes(oldStatus);

        if (isLeaving || isJoining) {
            // Ищем пользователя в глобальной таблице User
            const dbUser = await prisma.user.findUnique({
                where: { telegramId: BigInt(userId) }
            });

            if (dbUser) {
                // Меняем ему статус isLeft конкретно для этой группы
                await prisma.userStats.updateMany({
                    where: {
                        userId: dbUser.id,
                        chatId: BigInt(chatId)
                    },
                    data: {
                        isLeft: isLeaving // Если вышел — true, если зашел — false
                    }
                });
                console.log(`[CHAT_MEMBER] Пользователь ${userId} в чате ${chatId} изменен. Покинул чат: ${isLeaving}`);
            }
        }
    });
}