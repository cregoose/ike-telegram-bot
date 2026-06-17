import { Context } from "grammy";
import { prisma } from "../database/prisma";
import QuickChart from "quickchart-js";
import { InputFile } from "grammy";
import { scheduleDeletion } from "../utils/autoDelete";

// Вспомогательная функция для получения Понедельника для любой даты
function getMonday(d: Date): Date {
    const date = new Date(d);
    const day = date.getDay();
    // Корректируем, если текущий день — воскресенье (0)
    const diff = date.getDate() - day + (day === 0 ? -6 : 1);
    date.setDate(diff);
    date.setHours(0, 0, 0, 0);
    return date;
}

// Безопасный парсинг даты формата YYYY-MM-DD во избежание сдвигов часовых поясов
function parseLocalDate(dateStr: string): Date {
    const [year, month, day] = dateStr.split("-").map(Number);
    return new Date(year!, month! - 1, day!);
}

async function generateDynamicChart(chatId: bigint, userId: bigint): Promise<Buffer | null> {
    const activities = await prisma.dailyActivity.findMany({ 
        where: { chatId, userId }, 
        orderBy: { date: 'asc' } 
    });
    
    if (activities.length === 0) return null;
    
    const firstActivity = activities[0];
    if (!firstActivity) return null;
    
    const startDate = parseLocalDate(firstActivity.date);
    const endDate = new Date();
    
    // Группируем дневные активности в недельные бакеты
    // Ключ: YYYY-MM-DD Понедельника этой недели
    const weeklyMap = new Map<string, { posts: number; chars: number }>();
    
    activities.forEach((act) => {
        const dateObj = parseLocalDate(act.date);
        const monday = getMonday(dateObj);
        const mondayStr = monday.toISOString().slice(0, 10);
        
        const existing = weeklyMap.get(mondayStr) || { posts: 0, chars: 0 };
        weeklyMap.set(mondayStr, {
            posts: existing.posts + act.posts,
            chars: existing.chars + act.chars // Суммируем символы за всю неделю
        });
    });
    
    const labels: string[] = []; 
    const postsData: number[] = []; 
    const charsData: number[] = [];
    
    // Итерируемся неделя за неделей (от понедельника первой активности до текущей недели)
    let currentWeekMonday = getMonday(startDate);
    const endWeekMonday = getMonday(endDate);
    
    while (currentWeekMonday <= endWeekMonday) {
        const mondayStr = currentWeekMonday.toISOString().slice(0, 10);
        
        // Вычисляем воскресенье этой же недели для красивого лейбла
        const sunday = new Date(currentWeekMonday);
        sunday.setDate(sunday.getDate() + 6);
        
        const startDay = String(currentWeekMonday.getDate()).padStart(2, '0');
        const startMonth = String(currentWeekMonday.getMonth() + 1).padStart(2, '0');
        const endDay = String(sunday.getDate()).padStart(2, '0');
        const endMonth = String(sunday.getMonth() + 1).padStart(2, '0');
        
        // Формат лейбла: "08.06-14.06"
        labels.push(`${startDay}.${startMonth}-${endDay}.${endMonth}`);
        
        const weekData = weeklyMap.get(mondayStr);
        if (weekData) {
            postsData.push(weekData.posts);
            charsData.push(weekData.chars);
        } else {
            postsData.push(0);
            charsData.push(0);
        }
        
        // Шагаем ровно на 7 дней вперед к следующему понедельнику
        currentWeekMonday.setDate(currentWeekMonday.getDate() + 7);
    }
    
    const chart = new QuickChart();
    chart.setConfig({
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                { label: 'Посты за неделю', data: postsData, backgroundColor: '#ccff00', yAxisID: 'yPosts', order: 2 },
                { label: 'Символы за неделю', type: 'line', data: charsData, borderColor: '#00bfff', fill: false, tension: 0.3, yAxisID: 'yChars', order: 1 }
            ]
        },
        options: {
            title: { display: true, text: 'История активности (по неделям)', fontColor: '#ffffff', fontSize: 16 },
            legend: { labels: { fontColor: '#ffffff' } },
            scales: {
                xAxes: [{ gridLines: { color: 'rgba(255,255,255,0.05)' }, ticks: { fontColor: '#aaaaaa', maxRotation: 45, minRotation: 45 } }],
                yAxes: [
                    { id: 'yPosts', type: 'linear', position: 'left', ticks: { beginAtZero: true, fontColor: '#ccff00', stepSize: 1 }, scaleLabel: { display: true, labelString: 'Количество постов', fontColor: '#ccff00' } },
                    { id: 'yChars', type: 'linear', position: 'right', ticks: { beginAtZero: true, fontColor: '#00bfff' }, scaleLabel: { display: true, labelString: 'Количество символов', fontColor: '#00bfff' }, gridLines: { drawOnChartArea: false } }
                ]
            }
        }
    });
    
    chart.setWidth(900); 
    chart.setHeight(450); 
    chart.setBackgroundColor('#18181b');
    
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
        `📝 Количество постов:\n` +
        `• За неделю: ${stats.postsWeek}\n` +
        `• За месяц: ${stats.postsMonth}\n` +
        `• Всё время: ${stats.totalPosts}\n\n` +
        `🔥 Длина лучшего поста (символы):\n` +
        `• Неделя: ${stats.maxCharsWeek}\n` +
        `• Месяц: ${stats.maxCharsMonth}\n` +
        `• Всё время: ${stats.maxCharsAllTime}`;

    const chartBuffer = await generateDynamicChart(BigInt(ctx.chat.id), targetTelegramId);
    const sendToPM = chatSettings ? chatSettings.sendToPM : false;

    if (sendToPM && !isReply && isMyProfile) {
        try {
            if (chartBuffer) {
                await ctx.api.sendPhoto(ctx.from.id, new InputFile(chartBuffer, "chart.png"), { caption: profileText });
            } else {
                await ctx.api.sendMessage(ctx.from.id, profileText);
            }
            return replyAndSchedule(`🔒 Статистика отправлена тебе в личные сообщения, ${displayUsername}!`);
        } catch (error) {
            console.error(error);
            return replyAndSchedule(`⚠️ Не удалось отправить статистику в ЛС. Пожалуйста, запусти бота в личке (@${ctx.me.username}) и попробуй снова.`);
        }
    }

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