import { Context } from "grammy";

/**
 * Планирует удаление сообщений через указанное время (в минутах)
 */
export function scheduleDeletion(ctx: Context, chatId: number | string, messageIds: number[], delayMinutes: number) {
    if (delayMinutes <= 0) return;
    
    setTimeout(async () => {
        for (const msgId of messageIds) {
            try {
                await ctx.api.deleteMessage(chatId, msgId);
            } catch (e) {
                // Игнорируем ошибки (если сообщение уже удалено вручную админом)
            }
        }
    }, delayMinutes * 60 * 1000);
}