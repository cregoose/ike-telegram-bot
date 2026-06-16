import { Context, InlineKeyboard } from "grammy";
import { prisma } from "../database/prisma";

// Проверка на админа/создателя
async function checkIsAdmin(ctx: Context, userId: number): Promise<boolean> {
    if (ctx.chat?.type === "private") return true;
    try {
        const member = await ctx.getChatMember(userId);
        return member.status === "administrator" || member.status === "creator";
    } catch {
        return false;
    }
}

// Проверка: строго Владелец (Создатель) чата
async function checkIsCreator(ctx: Context, userId: number): Promise<boolean> {
    if (ctx.chat?.type === "private") return true;
    try {
        const member = await ctx.getChatMember(userId);
        return member.status === "creator";
    } catch {
        return false;
    }
}

// Главное меню настроек
async function getSettingsMenu(ctx: Context, chatId: bigint, messageIdToEdit?: number) {
    let settings = await prisma.chatSettings.findUnique({ where: { chatId } });
    if (!settings) {
        settings = await prisma.chatSettings.create({ data: { chatId } });
    }

    const currentMode = settings.sendToPM ? "🔒 В личные сообщения" : "👥 В группу";
    const text = `⚙️ Настройки Айка для этого чата\n\nТекущий режим вывода личной статистики:\n👉 **${currentMode}**\n\nВыбери, куда бот должен отправлять личную статистику участников этого чата:`;

    const keyboard = new InlineKeyboard()
        .text(settings.sendToPM ? "👥 Включить отправку в группу" : "🔒 Включить отправку в ЛС", `set_pm:${settings.sendToPM ? 0 : 1}:${chatId}`)
        .row()
        .text("🗑️ Удалить всю статистику чата", `confirm_clear:${chatId}`); // Кнопка удаления

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

    // 1. Смена режима отправки (ЛС / Группа)
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

    // 2. Первое нажатие на «Удалить всю статистику» (Запрос подтверждения)
    if (callbackData.startsWith("confirm_clear:")) {
        const chatId = BigInt(callbackData.split(":")[1] || "0");

        // Проверяем на Создателя чата
        if (!(await checkIsCreator(ctx, ctx.from.id))) {
            return ctx.answerCallbackQuery({ text: "👑 Эта функция доступна только Создателю (владельцу) этого чата!", show_alert: true });
        }

        await ctx.answerCallbackQuery();
        const confirmKeyboard = new InlineKeyboard()
            .text("🔥 Да, удалить абсолютно всё", `clear_yes:${chatId}`)
            .row()
            .text("❌ Отмена", `clear_no:${chatId}`);

        await ctx.api.editMessageText(
            ctx.chat!.id,
            ctx.callbackQuery.message!.message_id,
            `⚠️ **ВНИМАНИЕ!**\n\nВы собираетесь полностью и безвозвратно удалить всю накопленную статистику постов, символов и графики для ВСЕХ участников этого чата.\n\nВы уверены в своем решении?`,
            { reply_markup: confirmKeyboard, parse_mode: "Markdown" }
        );
    }

    // 3. Отмена удаления — возвращаем меню назад
    if (callbackData.startsWith("clear_no:")) {
        const chatId = BigInt(callbackData.split(":")[1] || "0");
        await ctx.answerCallbackQuery();
        await getSettingsMenu(ctx, chatId, ctx.callbackQuery.message?.message_id);
    }

    // 4. Финальное подтверждение удаления
    if (callbackData.startsWith("clear_yes:")) {
        const chatId = BigInt(callbackData.split(":")[1] || "0");

        if (!(await checkIsCreator(ctx, ctx.from.id))) {
            return ctx.answerCallbackQuery({ text: "❌ Доступно только создателю чата!", show_alert: true });
        }

        await ctx.answerCallbackQuery({ text: "Очистка базы данных...", show_alert: false });

        // Удаляем всю статистику и историю активности этого чата из БД
        await prisma.userStats.deleteMany({ where: { chatId } });
        await prisma.dailyActivity.deleteMany({ where: { chatId } });

        await ctx.api.editMessageText(
            ctx.chat!.id,
            ctx.callbackQuery.message!.message_id,
            `🗑️ База данных успешно очищена!\n\nВся статистика для этого чата была сброшена до нуля Создателем чата.`
        );
    }
}