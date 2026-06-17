import { Context } from "grammy";
import { parseTime } from "../utils/parseTime";
import { getReason } from "../utils/getReason";
import { prisma } from "../database/prisma"; // Изменено: добавили импорт бд
import { scheduleDeletion } from "../utils/autoDelete"; // Изменено: добавили импорт таймера

export async function moderationHandler(ctx: Context) {
    const message = ctx.message?.text;
    
    if (ctx.chat?.type === "private") return;
    if (!ctx.chat) return; // <-- ДОБАВЬ ЭТУ СТРОКУ сюда
    if (!message) return;
    
    const text = message.toLowerCase();

    // СЛОВА-ТРИГГЕРЫ
    const muteWords = ["мут", "mute", "заткнуть"];
    const unmuteWords = ["снять мут", "размут", "говори", "unmute"];
    const banWords = ["бан", "ban", "чс", "permban"];
    const unbanWords = ["разбан", "вернуть", "unban"];

    if (!ctx.message?.reply_to_message) return;

    const targetUser = ctx.message.reply_to_message.from;
    if (!targetUser) return;

    const userId = targetUser.id;

    // ПРОВЕРКА АДМИНА
    const member = await ctx.getChatMember(ctx.from!.id);
    const isAdmin = member.status === "administrator" || member.status === "creator";
    if (!isAdmin) return;

    // === НАСТРОЙКА АВТОУДАЛЕНИЯ ДЛЯ ЭТОГО ЧАТА ===
    const chatSettings = await prisma.chatSettings.findUnique({ where: { chatId: BigInt(ctx.chat.id) } });
    const deleteDelay = chatSettings?.autoDeleteTime || 0;

    // Локальный помощник для автоматического удаления ответов бота
    const replyAndSchedule = async (replyText: string) => {
        const botMsg = await ctx.reply(replyText);
        if (deleteDelay > 0) {
            scheduleDeletion(ctx, ctx.chat!.id, [botMsg.message_id], deleteDelay);
        }
        return botMsg;
    };

    const username = targetUser.username ? `@${targetUser.username}` : targetUser.first_name;

    // =========================
    // MUTE
    // =========================
    const isMute = muteWords.some(word => text.startsWith(word));

    if (isMute) {
        const targetMember = await ctx.getChatMember(userId);

        if (targetMember.status === "creator") {
            return replyAndSchedule("❌ Нельзя дать мут владельцу чата");
        }
        
        const { hours, minutes } = parseTime(text);
        const reason = getReason(text);
        const totalSeconds = hours * 60 * 60 + minutes * 60;
        const untilDate = Math.floor(Date.now() / 1000) + totalSeconds;

        try {
            await ctx.restrictChatMember(
                userId,
                { can_send_messages: false },
                { until_date: untilDate }
            );
        } catch {
            return replyAndSchedule("⚠️ Айку не хватает прав для мута");
        }

        return replyAndSchedule(`🔇 ${username} не может писать ${hours} ч. ${minutes} мин.\n\n📄 Причина: ${reason}`);
    }

    // =========================
    // UNMUTE
    // =========================
    const isUnmute = unmuteWords.some(word => text.startsWith(word));

    if (isUnmute) {
        await ctx.restrictChatMember(userId, { can_send_messages: true });
        return replyAndSchedule(`🔊 ${username}, вы снова можете говорить`);
    }

    // =========================
    // BAN
    // =========================
    const isBan = banWords.some(word => text.startsWith(word));

    if (isBan) {
        const targetMember = await ctx.getChatMember(userId);

        if (targetMember.status === "creator") {
            return replyAndSchedule("❌ Нельзя дать бан владельцу чата");
        }
        
        const reason = getReason(text);

        try {
            await ctx.banChatMember(userId);
        } catch {
            return replyAndSchedule("⚠️ Айку не хватает прав для бана");
        }

        return replyAndSchedule(`⛔ ${username} забанен\n\n📄 Причина: ${reason}`);
    }

    // =========================
    // UNBAN
    // =========================
    const isUnban = unbanWords.some(word => text.startsWith(word));

    if (isUnban) {
        await ctx.unbanChatMember(userId);
        return replyAndSchedule(`✅ ${username} может вернуться в чат`);
    }
}