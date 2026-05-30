import { Context } from "grammy";
import { prisma } from "../database/prisma";

export async function profileHandler(ctx: Context) {
    const message = ctx.message?.text?.toLowerCase();
    if (!message || !ctx.from || !ctx.chat) return;

    const words = ["профиль", "кто я", "моя стата", "моя статистика"];
    const isProfile = words.some(word => message.startsWith(word));
    if (!isProfile) return;

    // Ищем сначала пользователя
    const user = await prisma.user.findUnique({
        where: { telegramId: BigInt(ctx.from.id) },
    });

    if (!user) {
        return ctx.reply("Статистика не найдена");
    }

    // Ищем его статистику конкретно ДЛЯ ЭТОГО чата
    const stats = await prisma.userStats.findUnique({
        where: {
            userId_chatId: {
                userId: user.id,
                chatId: BigInt(ctx.chat.id)
            }
        }
    });

    const username = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name;

    // Если в этом чате он еще ничего не писал
    if (!stats) {
        return ctx.reply(`📖 Профиль ${username}\n\nВ этом чате у вас пока нет активности.`);
    }

    return ctx.reply(
        `📖 Профиль ${username}\n\n` +
        `📝 Постов в этом чате: ${stats.totalPosts}\n\n` +
        `🔥 Лучший пост в этом чате:\n\n` +
        `• Неделя: ${stats.maxCharsWeek}\n` +
        `• Месяц: ${stats.maxCharsMonth}\n` +
        `• Всё время: ${stats.maxCharsAllTime}`
    );
}