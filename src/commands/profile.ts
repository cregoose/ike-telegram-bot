import { Context } from "grammy";
import { prisma } from "../database/prisma";
import QuickChart from "quickchart-js";
import { InputFile } from "grammy";
import { scheduleDeletion } from "../utils/autoDelete"; // Изменено: добавили импорт таймера

// (Функции generateDynamicChart, isSameWeek, isSameMonth остаются без изменений)
async function generateDynamicChart(chatId: bigint, userId: bigint): Promise<Buffer | null> {
    const activities = await prisma.dailyActivity.findMany({ where: { chatId, userId }, orderBy: { date: 'asc' } });
    if (activities.length === 0) return null;
    const firstActivity = activities[0];
    if (!firstActivity) return null;
    const startDate = new Date(firstActivity.date);
    const endDate = new Date();
    const activityMap = new Map<string, { posts: number; chars: number }>();
    activities.forEach((act) => { activityMap.set(act.date, { posts: act.posts, chars: act.chars }); });
    const labels: string[] = []; const postsData: number[] = []; const charsData: number[] = [];
    let currentDate = new Date(startDate);
    while (currentDate <= endDate) {
        const dateStr = currentDate.toISOString().slice(0, 10);
        const day = String(currentDate.getDate()).padStart(2, '0');
        const month = String(currentDate.getMonth() + 1).padStart(2, '0');
        labels.push(`${day}.${month}`);
        const dayData = activityMap.get(dateStr);
        if (dayData) { postsData.push(dayData.posts); charsData.push(dayData.chars); }
        else { postsData.push(0); charsData.push(0); }
        currentDate.setDate(currentDate.getDate() + 1);
    }
    const chart = new QuickChart();
    chart.setConfig({
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                { label: 'Посты', data: postsData, backgroundColor: '#ccff00', yAxisID: 'yPosts', order: 2 },
                { label: 'Символы', type: 'line', data: charsData, borderColor: '#00bfff', fill: false, tension: 0.3, yAxisID: 'yChars', order: 1 }
            ]
        },
        options: {
            title: { display: true, text: 'История активности в чате', fontColor: '#ffffff', fontSize: 16 },
            legend: { labels: { fontColor: '#ffffff' } },
            scales: {
                xAxes: [{ gridLines: { color: 'rgba(255,255,255,0.05)' }, ticks: { fontColor: '#aaaaaa', maxRotation: 45, minRotation: 45 } }],
                yAxes: [
                    { id: 'yPosts', type: 'linear', position: 'left', ticks: { beginAtZero: true, fontColor: '#ccff00' }, scaleLabel: { display: true, labelString: 'Количество постов', fontColor: '#ccff00' } },
                    { id: 'yChars', type: 'linear', position: 'right', ticks: { beginAtZero: true, fontColor: '#00bfff' }, scaleLabel: { display: true, labelString: 'Количество символов', fontColor: '#00bfff' }, gridLines: { drawOnChartArea: false } }
                ]
            }
        }
    });
    chart.setWidth(900); chart.setHeight(450); chart.setBackgroundColor('#18181b');
    return Buffer.from(await chart.toBinary());
}

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

export async function profileHandler(ctx: Context) {
    const rawMessage = ctx.message?.text || ctx.message?.caption || "";
    const message = rawMessage.toLowerCase().trim();
    if (!message || !ctx.from || !ctx.chat || !ctx.message) return;

    const msg = ctx.message;
    const myProfileWords = ["профиль", "кто я", "моя стата", "моя статистика"];
    const targetProfileWords = ["кто ты", "стата", "статистика"];

    const isMyProfile = myProfileWords.some(word => message.startsWith(word));
    const isTargetProfile = targetProfileWords.some(word => message.startsWith(word));

    if (!isMyProfile && !isTargetProfile) return;

    // === ПОДПИСЫВАЕМ ТАЙМЕРЫ УДАЛЕНИЯ ===
    const chatSettings = await prisma.chatSettings.findUnique({ where: { chatId: BigInt(ctx.chat.id) } });
    const deleteDelay = chatSettings?.autoDeleteTime || 0;

    const replyAndSchedule = async (replyText: string) => {
        const botMsg = await ctx.reply(replyText);
        if (deleteDelay > 0) {
            scheduleDeletion(ctx, ctx.chat!.id, [botMsg.message_id], deleteDelay);
        }
        return botMsg;
    };

    let targetUserDbId: number | null = null;
    let targetTelegramId: bigint | null = null;
    let displayUsername = "";

    const isReply = !!msg.reply_to_message;
    const matchUsername = rawMessage.match(/@(\w+)/); 

    if (isTargetProfile && (isReply || matchUsername)) {
        if (ctx.chat.type === "group" || ctx.chat.type === "supergroup") {
            const chatMember = await ctx.getChatMember(ctx.from.id);
            const isAdmin = chatMember.status === "administrator" || chatMember.status === "creator";

            if (!isAdmin) {
                return replyAndSchedule("❌ Эта команда доступна только администраторам группы.");
            }
        }

        if (isReply) {
            const replyFrom = msg.reply_to_message?.from;
            if (!replyFrom || replyFrom.is_bot || replyFrom.id === 1087968824) {
                return replyAndSchedule("Проверить статистику ботов нельзя.");
            }
            
            const dbUser = await prisma.user.findUnique({ where: { telegramId: BigInt(replyFrom.id) } });
            if (!dbUser) return replyAndSchedule("Статистика этого пользователя не найдена в базе данных.");
            
            targetUserDbId = dbUser.id;
            targetTelegramId = dbUser.telegramId;
            displayUsername = replyFrom.username ? `@${replyFrom.username}` : replyFrom.first_name;
        } else if (matchUsername) {
            const targetUsername = matchUsername[1] as string; 

            const dbUser = await prisma.user.findFirst({ where: { username: { equals: targetUsername } } });
            if (!dbUser) {
                return replyAndSchedule(`Пользователь @${targetUsername} не найден в базе данных бота. Он должен написать хотя бы одно сообщение при включенном боте.`);
            }

            targetUserDbId = dbUser.id;
            targetTelegramId = dbUser.telegramId;
            displayUsername = `@${dbUser.username}`;
        }
    } else if (isMyProfile) {
        const dbUser = await prisma.user.findUnique({ where: { telegramId: BigInt(ctx.from.id) } });
        if (!dbUser) return replyAndSchedule("Статистика не найдена.");
        
        targetUserDbId = dbUser.id;
        targetTelegramId = dbUser.telegramId;
        displayUsername = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name;
    } else {
        return;
    }

    if (!targetUserDbId || !targetTelegramId) return;

    let stats = await prisma.userStats.findUnique({
        where: { userId_chatId: { userId: targetUserDbId, chatId: BigInt(ctx.chat.id) } }
    });

    if (!stats) {
        return replyAndSchedule(`📖 Профиль ${displayUsername}\n\nВ этом чате у пользователя пока нет активности.`);
    }

    const now = new Date();
    const updateData: any = {};

    if (!isSameWeek(stats.updatedAtWeek, now)) {
        updateData.maxCharsWeek = 0; updateData.postsWeek = 0; updateData.updatedAtWeek = now;
    }
    if (!isSameMonth(stats.updatedAtMonth, now)) {
        updateData.maxCharsMonth = 0; updateData.postsMonth = 0; updateData.updatedAtMonth = now;
    }
    if (Object.keys(updateData).length > 0) {
        stats = await prisma.userStats.update({ where: { id: stats.id }, data: updateData });
    }

    const profileText = 
        `📖 Профиль ${displayUsername}\n\n` +
        `📝 Количество постов in this чате:\n` +
        `• За неделю: ${stats.postsWeek}\n` +
        `• За месяц: ${stats.postsMonth}\n` +
        `• Всё время: ${stats.totalPosts}\n\n` +
        `🔥 Длина лучшего поста (символы):\n` +
        `• Неделя: ${stats.maxCharsWeek}\n` +
        `• Месяц: ${stats.maxCharsMonth}\n` +
        `• Всё время: ${stats.maxCharsAllTime}`;

    const chartBuffer = await generateDynamicChart(BigInt(ctx.chat.id), targetTelegramId);
    const sendToPM = chatSettings ? chatSettings.sendToPM : false;

    // =========================
    // ОТПРАВКА В ЛС
    // =========================
    if (sendToPM && !isReply && isMyProfile) {
        try {
            if (chartBuffer) {
                await ctx.api.sendPhoto(ctx.from.id, new InputFile(chartBuffer, "chart.png"), { caption: profileText });
            } else {
                await ctx.api.sendMessage(ctx.from.id, profileText);
            }
            // Удаляем сервисное сообщение в группе
            return replyAndSchedule(`🔒 Статистика отправлена тебе в личные сообщения, ${displayUsername}!`);
        } catch (error) {
            console.error(error);
            return replyAndSchedule(`⚠️ Не удалось отправить статистику в ЛС. Пожалуйста, запусти бота в личке (@${ctx.me.username}) и попробуй снова.`);
        }
    }

    // =========================
    // ОТПРАВКА В ГРУППУ (С графиком / Без графика)
    // =========================
    if (chartBuffer) {
        const botMsg = await ctx.replyWithPhoto(
            new InputFile(chartBuffer, "chart.png"),
            { caption: profileText }
        );
        if (deleteDelay > 0) {
            scheduleDeletion(ctx, ctx.chat.id, [botMsg.message_id], deleteDelay);
        }
        return;
    }

    return replyAndSchedule(profileText);
}