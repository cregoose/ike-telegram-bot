import { Context } from "grammy";
import { prisma } from "../database/prisma";
import { countCharacters } from "../utils/countCharacters";

// Храним и ID автора, и сколько символов он уже набрал в текущем "серийном" посте
const lastMessageMap = new Map<number, { userId: number; accumulatedChars: number }>();

export async function postTracker(ctx: Context) {
    if (!ctx.from || !ctx.message || !ctx.chat) return;

    const userId = ctx.from.id;
    const chatId = ctx.chat.id;

    const text = ctx.message.text || ctx.message.caption || "";
    const charsInThisMessage = countCharacters(text);

    // Получаем данные о предыдущем сообщении в этом чате
    const lastSession = lastMessageMap.get(chatId);
    
    // Пост новый, если автора не было ВООБЩЕ или это другой автор
    const isNewPost = !lastSession || lastSession.userId !== userId;

    let totalPostChars = charsInThisMessage;

    if (!isNewPost && lastSession) {
        // Если автор тот же, прибавляем символы к уже накопленным
        totalPostChars = lastSession.accumulatedChars + charsInThisMessage;
    }

    // Обновляем карту для следующего сообщения
    lastMessageMap.set(chatId, {
        userId,
        accumulatedChars: totalPostChars
    });

    // 1. Находим или создаем глобального пользователя
    let user = await prisma.user.findUnique({
        where: { telegramId: BigInt(userId) }
    });

    if (!user) {
        user = await prisma.user.create({
            data: {
                telegramId: BigInt(userId),
                username: ctx.from.username || null,
                firstName: ctx.from.first_name
            }
        });
    }

    // 2. Находим или создаем статистику пользователя ОТРЕЗАНО под конкретный чат
    let stats = await prisma.userStats.findUnique({
        where: {
            userId_chatId: {
                userId: user.id,
                chatId: BigInt(chatId)
            }
        }
    });

    if (!stats) {
        stats = await prisma.userStats.create({
            data: {
                userId: user.id,
                chatId: BigInt(chatId)
            }
        });
    }

    // 3. Формируем данные для обновления статистики группы
    const updateData: any = {};

    if (isNewPost) {
        updateData.totalPosts = {
            increment: 1
        };
    }

    // Сравниваем рекорды с ОБЩЕЙ длиной получившегося поста из объекта stats
    if (totalPostChars > stats.maxCharsWeek) {
        updateData.maxCharsWeek = totalPostChars;
    }

    if (totalPostChars > stats.maxCharsMonth) {
        updateData.maxCharsMonth = totalPostChars;
    }

    if (totalPostChars > stats.maxCharsAllTime) {
        updateData.maxCharsAllTime = totalPostChars;
    }

    // Если есть изменения — обновляем таблицу UserStats
    if (Object.keys(updateData).length > 0) {
        await prisma.userStats.update({
            where: {
                userId_chatId: {
                    userId: user.id,
                    chatId: BigInt(chatId)
                }
            },
            data: updateData
        });
    }
}