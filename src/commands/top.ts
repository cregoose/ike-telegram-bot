import { Context } from "grammy";
import { prisma } from "../database/prisma";
import { scheduleDeletion } from "../utils/autoDelete";

// (Функции isSameWeek, isSameMonth остаются без изменений)
function isSameWeek(d1: Date, d2: Date): boolean {
    const oneDay = 24 * 60 * 60 * 1000;
    const getWeekNumber = (d: Date) => {
        const date = new Date(d.getTime()); date.setHours(0, 0, 0, 0);
        date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
        const week1 = new Date(date.getFullYear(), 0, 4);
        return 1 + Math.round(((date.getTime() - week1.getTime()) / oneDay - 3 + (week1.getDay() + 6) % 7) / 7);
    };
    return d1.getFullYear() === d2.getFullYear() && getWeekNumber(d1) === getWeekNumber(d2);
}
function isSameMonth(d1: Date, d2: Date): boolean { return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth(); }

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

    // === НАСТРОЙКА АВТОУДАЛЕНИЯ ДЛЯ ЭТОГО ЧАТА ===
    const chatSettings = await prisma.chatSettings.findUnique({ where: { chatId: BigInt(ctx.chat.id) } });
    const deleteDelay = chatSettings?.autoDeleteTime || 0;

    const replyAndSchedule = async (replyText: string) => {
        const botMsg = await ctx.reply(replyText);
        if (deleteDelay > 0) {
            scheduleDeletion(ctx, ctx.chat!.id, [botMsg.message_id], deleteDelay);
        }
        return botMsg;
    };

    const now = new Date();
    const allStats = await prisma.userStats.findMany({ where: { chatId: BigInt(ctx.chat.id), isLeft: false } });

    for (const stats of allStats) {
        const updateData: any = {};
        if (period === "week" && !isSameWeek(stats.updatedAtWeek, now)) {
            updateData.maxCharsWeek = 0; updateData.postsWeek = 0; updateData.updatedAtWeek = now;
        }
        if (period === "month" && !isSameMonth(stats.updatedAtMonth, now)) {
            updateData.maxCharsMonth = 0; updateData.postsMonth = 0; updateData.updatedAtMonth = now;
        }
        if (Object.keys(updateData).length > 0) {
            await prisma.userStats.update({ where: { id: stats.id }, data: updateData });
        }
    }

    let field = "maxCharsAllTime";
    let periodTitle = "за всё время";

    if (mode === "posts") {
        if (period === "week") { field = "postsWeek"; periodTitle = "за неделю"; } 
        else if (period === "month") { field = "postsMonth"; periodTitle = "за месяц"; } 
        else { field = "totalPosts"; periodTitle = "за всё время"; }
    } else {
        if (period === "week") { field = "maxCharsWeek"; periodTitle = "за неделю"; } 
        else if (period === "month") { field = "maxCharsMonth"; periodTitle = "за месяц"; } 
        else { field = "maxCharsAllTime"; periodTitle = "за всё время"; }
    }

    const leaderBoard = await prisma.userStats.findMany({
        where: { chatId: BigInt(ctx.chat.id), isLeft: false },
        orderBy: { [field]: "desc" },
        take: 10,
        include: { user: true }
    });

    if (!leaderBoard.length) {
        return replyAndSchedule("В этом чате еще нет статистики.");
    }

    const modeTitle = mode === "posts" ? "постам" : "символам";
    let text = `🏆 Топ пользователей этого чата по ${modeTitle} ${periodTitle}:\n\n`;

    leaderBoard.forEach((statsEntry, index) => {
        text += `${index + 1}. ${statsEntry.user.firstName}\n`;
        if (mode === "posts") {
            const postCount = statsEntry[field as 'totalPosts' | 'postsWeek' | 'postsMonth'];
            text += `Постов: ${postCount}\n\n`;
        } else {
            const charCount = statsEntry[field as 'maxCharsWeek' | 'maxCharsMonth' | 'maxCharsAllTime'];
            text += `Длина лучшего поста: ${charCount} симв.\n\n`;
        }
    });

    return replyAndSchedule(text);
}