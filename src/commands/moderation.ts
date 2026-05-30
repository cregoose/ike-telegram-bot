import { Context } from "grammy";

import { parseTime } from "../utils/parseTime";
import { getReason } from "../utils/getReason";

export async function moderationHandler(
    ctx: Context
) {
    const message = ctx.message?.text;
    
    if (ctx.chat?.type === "private") return;

    if (!message) return;

    const text = message.toLowerCase();

    // =========================
    // СЛОВА
    // =========================

    const muteWords = [
        "мут",
        "mute",
        "заткнуть",
    ];

    const unmuteWords = [
        "снять мут",
        "размут",
        "говори",
        "unmute",
    ];

    const banWords = [
        "бан",
        "ban",
        "чс",
        "permban",
    ];

    const unbanWords = [
        "разбан",
        "вернуть",
        "unban",
    ];

    // =========================
    // REPLY
    // =========================

    if (!ctx.message?.reply_to_message) return;

    const targetUser =
        ctx.message.reply_to_message.from;

    if (!targetUser) return;

    const userId = targetUser.id;

    // =========================
    // ПРОВЕРКА АДМИНА
    // =========================

    const member = await ctx.getChatMember(
        ctx.from!.id
    );

    const isAdmin =
        member.status === "administrator" ||
        member.status === "creator";

    if (!isAdmin) return;

    // =========================
    // USERNAME
    // =========================

    const username =
        targetUser.username
            ? `@${targetUser.username}`
            : targetUser.first_name;

    // =========================
    // MUTE
    // =========================

    const isMute = muteWords.some(word =>
        text.startsWith(word)
    );

    if (isMute) {

    const targetMember =
        await ctx.getChatMember(userId);

    if (targetMember.status === "creator") {
        return ctx.reply(
            "❌ Нельзя дать мут владельцу чата"
        );
    }
        const { hours, minutes } =
            parseTime(text);

        const reason = getReason(text);

        const totalSeconds =
            hours * 60 * 60 +
            minutes * 60;

        const untilDate =
            Math.floor(Date.now() / 1000) +
            totalSeconds;

        try {
    await ctx.restrictChatMember(
        userId,
        {
            can_send_messages: false,
        },
        {
            until_date: untilDate,
        }
    );
} catch {
    return ctx.reply(
        "⚠️ Айку не хватает прав для мута"
    );
}

        return ctx.reply(
            `🔇 ${username} не может писать ${hours} ч. ${minutes} мин.

📄 Причина: ${reason}`
        );
    }

    // =========================
    // UNMUTE
    // =========================

    const isUnmute = unmuteWords.some(word =>
        text.startsWith(word)
    );

    if (isUnmute) {
        await ctx.restrictChatMember(userId, {
            can_send_messages: true,
        });

        return ctx.reply(
            `🔊 ${username}, вы снова можете говорить`
        );
    }

    // =========================
    // BAN
    // =========================

    const isBan = banWords.some(word =>
        text.startsWith(word)
    );

    if (isBan) {

    const targetMember =
        await ctx.getChatMember(userId);

    if (targetMember.status === "creator") {
        return ctx.reply(
            "❌ Нельзя дать бан владельцу чата"
        );
    }
        const reason = getReason(text);

        try {
    await ctx.banChatMember(userId);
} catch {
    return ctx.reply(
        "⚠️ Айку не хватает прав для бана"
    );
}

        return ctx.reply(
            `⛔ ${username} забанен

📄 Причина: ${reason}`
        );
    }

    // =========================
    // UNBAN
    // =========================

    const isUnban = unbanWords.some(word =>
        text.startsWith(word)
    );

    if (isUnban) {
        await ctx.unbanChatMember(userId);

        return ctx.reply(
            `✅ ${username} может вернуться в чат`
        );
    }
}