import { Context, InlineKeyboard } from "grammy";
import { prisma } from "../database/prisma";

// Мапа для отслеживания админов, от которых мы ждем число для лимита символов
export const waitingForMinChars = new Map<number, bigint>(); // userId -> chatId

async function checkIsAdmin(ctx: Context, userId: number): Promise<boolean> {
    if (!ctx.chat || ctx.chat.type === "private") return true;
    try {
        const member = await ctx.getChatMember(userId);
        return member.status === "administrator" || member.status === "creator";
    } catch {
        return false;
    }
}

async function checkIsCreator(ctx: Context, userId: number): Promise<boolean> {
    if (!ctx.chat || ctx.chat.type === "private") return true;
    try {
        const member = await ctx.getChatMember(userId);
        return member.status === "creator";
    } catch {
        return false;
    }
}

// Главное меню настроек
export async function getSettingsMenu(ctx: Context, chatId: bigint, messageIdToEdit?: number) {
    let settings = await prisma.chatSettings.findUnique({ where: { chatId } });
    if (!settings) {
        settings = await prisma.chatSettings.create({ data: { chatId } });
    }

    const currentMode = settings.sendToPM ? "🔒 В личные сообщения" : "👥 В группу";
    
    let minCharsText = "❌ Выключен";
    if (settings.minChars > 0) {
        minCharsText = `📝 от ${settings.minChars} симв. (${settings.minCharsAction === "DELETE_WARN" ? "Удаление + Варинг" : "Только варнинг"})`;
    }

    let autoDelText = "❌ Выключено";
    if (settings.autoDeleteTime > 0) {
        autoDelText = `⏳ ${settings.autoDeleteTime >= 60 ? settings.autoDeleteTime / 60 + " ч." : settings.autoDeleteTime + " мин."}`;
    }

    const text = `⚙️ Настройки Айка для этого чата\n\n` +
                 `1️⃣ Режим вывода личной статистики:\n👉 **${currentMode}**\n\n` +
                 `2️⃣ Минимальный порог символов для поста:\n👉 **${minCharsText}**\n\n` +
                 `3️⃣ Автоудаление команд и ответов бота:\n👉 **${autoDelText}**`;

    const keyboard = new InlineKeyboard()
        .text(settings.sendToPM ? "👥 Отправка в группу" : "🔒 Отправка в ЛС", `set_pm:${settings.sendToPM ? 0 : 1}:${chatId}`)
        .text("📝 Настроить лимит символов", `setup_min_chars:${chatId}`)
        .row()
        .text("⏳ Настроить автоудаление", `setup_autodelete:${chatId}`)
        .row()
        .text("🗑️ Удалить всю статистику чата", `confirm_clear:${chatId}`);

    if (messageIdToEdit) {
        try {
            await ctx.api.editMessageText(ctx.chat!.id, messageIdToEdit, text, { reply_markup: keyboard, parse_mode: "Markdown" });
        } catch {}
    } else {
        await ctx.reply(text, { reply_markup: keyboard, parse_mode: "Markdown" });
    }
}

export async function settingsHandler(ctx: Context) {
    const message = ctx.message?.text?.toLowerCase().trim();
    if (!message || !ctx.from || !ctx.chat) return;

    if (message !== "настройки айка" && message !== "настройки") return;

    const isAdmin = await checkIsAdmin(ctx, ctx.from.id);
    if (!isAdmin) {
        return ctx.reply("❌ Изменять настройки бота могут только администраторы группы.");
    }

    await getSettingsMenu(ctx, BigInt(ctx.chat.id));
}

export async function settingsCallbackHandler(ctx: Context) {
    const callbackData = ctx.callbackQuery?.data;
    if (!callbackData || !ctx.from) return;

    // Смена режима вывода
    if (callbackData.startsWith("set_pm:")) {
        const [, targetModeStr, chatIdStr] = callbackData.split(":");
        const targetMode = targetModeStr === "1";
        const chatId = BigInt(chatIdStr || "0");

        if (!(await checkIsAdmin(ctx, ctx.from.id))) {
            return ctx.answerCallbackQuery({ text: "У вас нет прав администратора!", show_alert: true });
        }

        await ctx.answerCallbackQuery();
        await prisma.chatSettings.upsert({
            where: { chatId },
            update: { sendToPM: targetMode },
            create: { chatId, sendToPM: targetMode }
        });
        await getSettingsMenu(ctx, chatId, ctx.callbackQuery.message?.message_id);
    }

    // Инициация настройки минимального количества символов
    if (callbackData.startsWith("setup_min_chars:")) {
        const chatIdStr = callbackData.split(":")[1];
        if (!chatIdStr) return; 
        
        const chatId = BigInt(chatIdStr);

        if (!(await checkIsAdmin(ctx, ctx.from.id))) {
            return ctx.answerCallbackQuery({ text: "У вас нет прав администратора!", show_alert: true });
        }
        await ctx.answerCallbackQuery();
        
        waitingForMinChars.set(ctx.from.id, chatId);
        
        if (!ctx.chat || !ctx.callbackQuery.message) return;

        await ctx.api.editMessageText(
            ctx.chat.id,
            ctx.callbackQuery.message.message_id,
            `📝 Настройка лимита текста\n\nНапишите в чат число — минимальное количество символов, необходимое для проверки поста.\n\nЧтобы отключить лимит, пришлите число 0.`,
            { parse_mode: "Markdown" }
        );
    }

    // Выбор наказания за недостачу символов
    if (callbackData.startsWith("set_min_act:")) {
        const [, action, chatIdStr, numStr] = callbackData.split(":");
        
        // Защита: если хоть один параметр не распарсился, выходим
        if (!action || !chatIdStr || !numStr) return;

        const chatId = BigInt(chatIdStr);
        const num = parseInt(numStr);

        await prisma.chatSettings.upsert({
            where: { chatId },
            update: { minChars: num, minCharsAction: action },
            create: { chatId, minChars: num, minCharsAction: action }
        });
        await ctx.answerCallbackQuery({ text: "Параметры лимита сохранены!" });
        await getSettingsMenu(ctx, chatId, ctx.callbackQuery.message?.message_id);
    }

    // Меню настройки автоудаления
    if (callbackData.startsWith("setup_autodelete:")) {
        const chatId = callbackData.split(":")[1];
        if (!chatId) return;

        await ctx.answerCallbackQuery();

        const kb = new InlineKeyboard()
            .text("30 мин", `set_del:30:${chatId}`)
            .text("1 час", `set_del:60:${chatId}`)
            .row()
            .text("4 часа", `set_del:240:${chatId}`)
            .text("12 часов", `set_del:720:${chatId}`)
            .row()
            .text("❌ Отключить автоудаление", `set_del:0:${chatId}`);

        await ctx.api.editMessageText(
            ctx.chat!.id,
            ctx.callbackQuery.message!.message_id,
            `⏳ Настройка автоудаления\n\nВыберите, через какое время бот будет автоматически удалять команды участников и свои ответы на них:`,
            { reply_markup: kb }
        );
    }

    // Сохранение времени автоудаления
    if (callbackData.startsWith("set_del:")) {
        const [, minsStr, chatIdStr] = callbackData.split(":");
        
        // Защита от undefined
        if (!minsStr || !chatIdStr) return;

        const minutes = parseInt(minsStr);
        const chatId = BigInt(chatIdStr);

        await prisma.chatSettings.upsert({
            where: { chatId },
            update: { autoDeleteTime: minutes },
            create: { chatId, autoDeleteTime: minutes }
        });
        await ctx.answerCallbackQuery({ text: "Таймер автоудаления обновлен!" });
        await getSettingsMenu(ctx, chatId, ctx.callbackQuery.message?.message_id);
    }

    // Очистка статистики
    if (callbackData.startsWith("confirm_clear:")) {
        const chatId = BigInt(callbackData.split(":")[1] || "0");
        if (!(await checkIsCreator(ctx, ctx.from.id))) {
            return ctx.answerCallbackQuery({ text: "Эта функция доступна только Создателю чата!", show_alert: true });
        }
        await ctx.answerCallbackQuery();
        const confirmKeyboard = new InlineKeyboard()
            .text("🔥 Да, удалить абсолютно всё", `clear_yes:${chatId}`)
            .row()
            .text("❌ Отмена", `clear_no:${chatId}`);

        await ctx.api.editMessageText(ctx.chat!.id, ctx.callbackQuery.message!.message_id, `⚠️ ВНИМАНИЕ!\n\nВы удаляете всю статистику для ВСЕХ участников.\nУверены?`, { reply_markup: confirmKeyboard, parse_mode: "Markdown" });
    }

    if (callbackData.startsWith("clear_no:")) {
        const chatId = BigInt(callbackData.split(":")[1] || "0");
        await ctx.answerCallbackQuery();
        await getSettingsMenu(ctx, chatId, ctx.callbackQuery.message?.message_id);
    }

    if (callbackData.startsWith("clear_yes:")) {
        const chatId = BigInt(callbackData.split(":")[1] || "0");
        if (!(await checkIsCreator(ctx, ctx.from.id))) return ctx.answerCallbackQuery({ text: "❌ Доступно только создателю чата!", show_alert: true });
        await ctx.answerCallbackQuery({ text: "Очистка базы данных..." });
        await prisma.userStats.deleteMany({ where: { chatId } });
        await prisma.dailyActivity.deleteMany({ where: { chatId } });
        await ctx.api.editMessageText(ctx.chat!.id, ctx.callbackQuery.message!.message_id, `🗑️ База данных успешно очищена!`);
    }
}