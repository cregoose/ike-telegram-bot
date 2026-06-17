import { Context, InlineKeyboard } from "grammy";
import { prisma } from "../database/prisma";
import { countCharacters } from "../utils/countCharacters";
import { waitingForMinChars, getSettingsMenu } from "../commands/settings";
import { scheduleDeletion } from "../utils/autoDelete";

const lastMessageMap = new Map<number, { userId: number; accumulatedChars: number }>();

function isSameWeek(d1: Date, d2: Date): boolean {
    const oneDay = 24 * 60 * 60 * 1000;
    const getWeekNumber = (d: Date) => {
        const date = new Date(d.getTime());
        date.setHours(0, 0, 0, 0);
        date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
        const week1 = new Date(date.getFullYear(), 0, 4);
        return 1 + Math.round(((date.getTime() - week1.getTime()) / oneDay - 3 + (week1.getDay() + 6) % 7) / 7);
    };
    return d1.getFullYear() === d2.getFullYear() && getWeekNumber(d1) === getWeekNumber(d2);
}

function isSameMonth(d1: Date, d2: Date): boolean {
    return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth();
}

export async function postTracker(ctx: Context) {
    if (!ctx.from || !ctx.message || !ctx.chat) return;
    if (ctx.from.is_bot || ctx.from.id === 1087968824) return;

    const userId = ctx.from.id;
    const chatId = ctx.chat.id;

    // === ПЕРЕХВАТ ВВОДА ДЛЯ НАСТРОЕК МИН. СИМВОЛОВ ===
    if (waitingForMinChars.has(userId) && waitingForMinChars.get(userId) === BigInt(chatId)) {
        const textInput = ctx.message.text || "";
        const num = parseInt(textInput.trim());

        if (isNaN(num) || num < 0) {
            await ctx.reply("❌ Пожалуйста, введите корректное целое число (0 или больше).");
            return;
        }

        waitingForMinChars.delete(userId);

        if (num === 0) {
            await prisma.chatSettings.upsert({
                where: { chatId: BigInt(chatId) },
                update: { minChars: 0, minCharsAction: "NONE" },
                create: { chatId: BigInt(chatId), minChars: 0, minCharsAction: "NONE" }
            });
            await ctx.reply("✅ Проверка минимального количества символов отключена.");
            await getSettingsMenu(ctx, BigInt(chatId));
            return;
        }

        // Если число > 0, спрашиваем, что делать в случае нехватки символов
        const actKeyboard = new InlineKeyboard()
            .text("🗑️ Удалять пост + предупреждение", `set_min_act:DELETE_WARN:${chatId}:${num}`)
            .row()
            .text("⚠️ Только устное предупреждение", `set_min_act:WARN:${chatId}:${num}`);

        await ctx.reply(`Вы выбрали порог в **${num}** символов.\nЧто делать Айку, если в посте символов меньше указанного?`, {
            reply_markup: actKeyboard,
            parse_mode: "Markdown"
        });
        return;
    }

    const text = ctx.message.text || ctx.message.caption || "";
    const charsInThisMessage = countCharacters(text);
    const messageLower = text.toLowerCase().trim();

    const commandTriggers = [
        "/", "топ", "стата", "статистика", "профиль", 
        "кто я", "моя стата", "моя статистика", 
        "кто ты", "настройки айка", "настройки",
        "мут", "mute", "заткнуть", "снять мут", "размут", "говори", "unmute",
        "бан", "ban", "чс", "permban", "разбан", "вернуть", "unban"
    ];

    const isCommand = commandTriggers.some(trigger => messageLower.startsWith(trigger));

    // === ЛОГИКА АВТОУДАЛЕНИЯ ДЛЯ КОМАНД УЧАСТНИКОВ ===
    let chatSettings = await prisma.chatSettings.findUnique({ where: { chatId: BigInt(chatId) } });
    if (!chatSettings) {
        chatSettings = await prisma.chatSettings.create({ data: { chatId: BigInt(chatId) } });
    }

    if (isCommand) {
        if (chatSettings.autoDeleteTime > 0) {
            // Удаляем команду участника через X минут
            scheduleDeletion(ctx, chatId, [ctx.message.message_id], chatSettings.autoDeleteTime);
        }
        return; 
    }

    // === ПРОВЕРКА МИНИМАЛЬНОГО КОЛИЧЕСТВА СИМВОЛОВ ===
    if (chatSettings.minChars > 0 && charsInThisMessage < chatSettings.minChars) {
        
        // Действие 1: Удалять пост и присылать предупреждение
        if (chatSettings.minCharsAction === "DELETE_WARN") {
            try {
                await ctx.deleteMessage();
            } catch {}
            
            const warn = await ctx.reply(`⚠️ @${ctx.from.username || ctx.from.first_name}, твой пост удален, так как он слишком короткий (${charsInThisMessage}/${chatSettings.minChars} симв.) и не засчитан!`);
            if (chatSettings.autoDeleteTime > 0) {
                scheduleDeletion(ctx, chatId, [warn.message_id], chatSettings.autoDeleteTime);
            }
        } 
        // Действие 2: Только устное предупреждение
        else if (chatSettings.minCharsAction === "WARN") {
            const warn = await ctx.reply(`⚠️ @${ctx.from.username || ctx.from.first_name}, твой пост слишком короткий (${charsInThisMessage}/${chatSettings.minChars} симв.) и не будет засчитан в статистику!`);
            if (chatSettings.autoDeleteTime > 0) {
                scheduleDeletion(ctx, chatId, [ctx.message.message_id, warn.message_id], chatSettings.autoDeleteTime);
            }
        }

        return; // КРИТИЧНО: Прерываем выполнение функции, пост НЕ идет в базу и рекорды!
    }

    // === ДАЛЬНЕЙШИЙ УЧЕТ СТАТИСТИКИ (Твой оригинальный код) ===
    const todayStr = new Date().toISOString().slice(0, 10);
    const textLength = charsInThisMessage;

    await prisma.dailyActivity.upsert({
        where: { chatId_userId_date: { chatId: BigInt(ctx.chat.id), userId: BigInt(ctx.from.id), date: todayStr } },
        update: { posts: { increment: 1 }, chars: { increment: textLength } },
        create: { chatId: BigInt(ctx.chat.id), userId: BigInt(ctx.from.id), date: todayStr, posts: 1, chars: textLength }
    });

    const lastSession = lastMessageMap.get(chatId);
    const isNewPost = !lastSession || lastSession.userId !== userId;

    let totalPostChars = charsInThisMessage;
    if (!isNewPost && lastSession) {
        totalPostChars = lastSession.accumulatedChars + charsInThisMessage;
    }

    lastMessageMap.set(chatId, { userId, accumulatedChars: totalPostChars });

    let user = await prisma.user.findUnique({ where: { telegramId: BigInt(userId) } });
    if (!user) {
        user = await prisma.user.create({ data: { telegramId: BigInt(userId), username: ctx.from.username || null, firstName: ctx.from.first_name } });
    }

    let stats = await prisma.userStats.findUnique({ where: { userId_chatId: { userId: user.id, chatId: BigInt(chatId) } } });
    if (!stats) {
        stats = await prisma.userStats.create({ data: { userId: user.id, chatId: BigInt(chatId) } });
    }

    const now = new Date();
    const updateData: any = {};

    if (isNewPost) updateData.totalPosts = { increment: 1 };

    let currentMaxWeek = stats.maxCharsWeek;
    let currentPostsWeek = stats.postsWeek;

    if (!isSameWeek(stats.updatedAtWeek, now)) {
        currentMaxWeek = 0; currentPostsWeek = 0; updateData.updatedAtWeek = now;
    }
    if (isNewPost) updateData.postsWeek = currentPostsWeek + 1;
    if (totalPostChars > currentMaxWeek) {
        updateData.maxCharsWeek = totalPostChars; updateData.updatedAtWeek = now;
    } else if (!isSameWeek(stats.updatedAtWeek, now)) {
        updateData.maxCharsWeek = totalPostChars;
    }

    let currentMaxMonth = stats.maxCharsMonth;
    let currentPostsMonth = stats.postsMonth;

    if (!isSameMonth(stats.updatedAtMonth, now)) {
        currentMaxMonth = 0; currentPostsMonth = 0; updateData.updatedAtMonth = now;
    }
    if (isNewPost) updateData.postsMonth = currentPostsMonth + 1;
    if (totalPostChars > currentMaxMonth) {
        updateData.maxCharsMonth = totalPostChars; updateData.updatedAtMonth = now;
    } else if (!isSameMonth(stats.updatedAtMonth, now)) {
        updateData.maxCharsMonth = totalPostChars;
    }

    if (totalPostChars > stats.maxCharsAllTime) updateData.maxCharsAllTime = totalPostChars;

    if (Object.keys(updateData).length > 0) {
        await prisma.userStats.update({ where: { userId_chatId: { userId: user.id, chatId: BigInt(chatId) } }, data: updateData });
    }
}