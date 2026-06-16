import { Context } from "grammy";
import { prisma } from "../database/prisma";
import { countCharacters } from "../utils/countCharacters";

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

    // ИГНОРИРУЕМ БОТОВ: если сообщение отправлено ботом или анонимным системным ботом группы
    if (ctx.from.is_bot || ctx.from.id === 1087968824) return;

    const userId = ctx.from.id;
    const chatId = ctx.chat.id;

    const text = ctx.message.text || ctx.message.caption || "";
    const charsInThisMessage = countCharacters(text);
    const messageLower = text.toLowerCase().trim();

    // ПОПОЛНЕННЫЙ СПИСОК ИГНОРИРУЕМЫХ КОМАНД (Системные + Статистика + Модерация)
    const commandTriggers = [
        "/", // Игнорирует любые классические команды на слэш (типа /start, /help)
        "топ", "стата", "статистика", "профиль", 
        "кто я", "моя стата", "моя статистика", 
        "кто ты", "настройки айка", "настройки",
        // Команды модерации:
        "мут", "mute", "заткнуть",
        "снять мут", "размут", "говори", "unmute",
        "бан", "ban", "чс", "permban",
        "разбан", "вернуть", "unban"
    ];

    // Проверяем: если сообщение начинается с любого триггера — полностью выходим из трекера
    const isCommand = commandTriggers.some(trigger => 
        messageLower.startsWith(trigger)
    );

    if (isCommand) return;

    // Получаем текущую дату в формате YYYY-MM-DD (например, "2026-06-16")
    const todayStr = new Date().toISOString().slice(0, 10);
    const textLength = charsInThisMessage;

    await prisma.dailyActivity.upsert({
        where: {
            chatId_userId_date: {
                chatId: BigInt(ctx.chat.id),
                userId: BigInt(ctx.from.id),
                date: todayStr
            }
        },
        update: {
            posts: { increment: 1 },
            chars: { increment: textLength }
        },
        create: {
            chatId: BigInt(ctx.chat.id),
            userId: BigInt(ctx.from.id),
            date: todayStr,
            posts: 1,
            chars: textLength
        }
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
        user = await prisma.user.create({
            data: {
                telegramId: BigInt(userId),
                username: ctx.from.username || null,
                firstName: ctx.from.first_name
            }
        });
    }

    let stats = await prisma.userStats.findUnique({
        where: { userId_chatId: { userId: user.id, chatId: BigInt(chatId) } }
    });

    if (!stats) {
        stats = await prisma.userStats.create({
            data: { userId: user.id, chatId: BigInt(chatId) }
        });
    }

    const now = new Date();
    const updateData: any = {};

    // Глобальный счетчик за всё время
    if (isNewPost) {
        updateData.totalPosts = { increment: 1 };
    }

    // --- ОБРАБОТКА НЕДЕЛИ (Символы + Посты) ---
    let currentMaxWeek = stats.maxCharsWeek;
    let currentPostsWeek = stats.postsWeek;

    // Проверяем смену недели
    if (!isSameWeek(stats.updatedAtWeek, now)) {
        currentMaxWeek = 0;
        currentPostsWeek = 0; 
        updateData.updatedAtWeek = now;
    }

    // Считаем посты за неделю
    if (isNewPost) {
        updateData.postsWeek = currentPostsWeek + 1;
    }

    // Проверяем рекорд символов за неделю
    if (totalPostChars > currentMaxWeek) {
        updateData.maxCharsWeek = totalPostChars;
        updateData.updatedAtWeek = now;
    } else if (!isSameWeek(stats.updatedAtWeek, now)) {
        updateData.maxCharsWeek = totalPostChars;
    }

    // --- ОБРАБОТКА МЕСЯЦА (Символы + Посты) ---
    let currentMaxMonth = stats.maxCharsMonth;
    let currentPostsMonth = stats.postsMonth;

    // Проверяем смену месяца
    if (!isSameMonth(stats.updatedAtMonth, now)) {
        currentMaxMonth = 0;
        currentPostsMonth = 0; 
        updateData.updatedAtMonth = now;
    }

    // Считаем посты за месяц
    if (isNewPost) {
        updateData.postsMonth = currentPostsMonth + 1;
    }

    // Проверяем рекорд символов за месяц
    if (totalPostChars > currentMaxMonth) {
        updateData.maxCharsMonth = totalPostChars;
        updateData.updatedAtMonth = now;
    } else if (!isSameMonth(stats.updatedAtMonth, now)) {
        updateData.maxCharsMonth = totalPostChars;
    }

    // --- ВСЁ ВРЕМЯ (Символы) ---
    if (totalPostChars > stats.maxCharsAllTime) {
        updateData.maxCharsAllTime = totalPostChars;
    }

    if (Object.keys(updateData).length > 0) {
        await prisma.userStats.update({
            where: { userId_chatId: { userId: user.id, chatId: BigInt(chatId) } },
            data: updateData
        });
    }
}