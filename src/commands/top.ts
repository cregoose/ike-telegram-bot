import { Context } from "grammy";
import { prisma } from "../database/prisma";

export async function topHandler(ctx: Context) {
    const message = ctx.message?.text?.toLowerCase();
    if (!message || !ctx.chat) return;

    const triggerWords = ["топ", "стата", "статистика"];
    const hasTrigger = triggerWords.some(word => message.startsWith(word));
    if (!hasTrigger) return;

    let mode = "";
    if (message.includes("символ")) mode = "chars";
    if (message.includes("пост")) mode = "posts";
    if (!mode) return;

    let period = "all";
    if (message.includes("нед")) period = "week";
    if (message.includes("меся")) period = "month";

    let field = "maxCharsAllTime";
    if (mode === "posts") {
        field = "totalPosts";
    } else {
        if (period === "week") field = "maxCharsWeek";
        if (period === "month") field = "maxCharsMonth";
    }

    // Делаем запрос к userStats с фильтром по текущему чату
    const leaderBoard = await prisma.userStats.findMany({
        where: {
            chatId: BigInt(ctx.chat.id)
        },
        orderBy: {
            [field]: "desc"
        },
        take: 10,
        include: {
            user: true // Подгружаем данные юзера (имя), чтобы отобразить в топе
        }
    });

    if (!leaderBoard.length) {
        return ctx.reply("В этом чате еще нет статистики.");
    }

    let text = "🏆 Топ пользователей этого чата:\n\n";

    leaderBoard.forEach((statsEntry, index) => {
        text += `${index + 1}. ${statsEntry.user.firstName}\n`;

        if (mode === "posts") {
            text += `Постов: ${statsEntry.totalPosts}\n\n`;
        } else {
            text += `Символов: ${statsEntry[field as 'maxCharsWeek' | 'maxCharsMonth' | 'maxCharsAllTime']}\n\n`;
        }
    });

    return ctx.reply(text);
}