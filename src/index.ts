import { Bot } from "grammy";
import dotenv from "dotenv";
import http from 'http';

import { moderationHandler } from "./commands/moderation";
import { postTracker } from "./handlers/postTracker";
import { profileHandler } from "./commands/profile";
import { topHandler } from "./commands/top";
import { settingsHandler, settingsCallbackHandler } from "./commands/settings";
import { setupChatMemberHandler } from "./handlers/chatMember";

dotenv.config();

const bot = new Bot(process.env.BOT_TOKEN!);

bot.command("start", async (ctx) => {
    await ctx.reply("Бот работает!");
});

// Слушаем обычные сообщения, фотографии, аудио, видео и документы
bot.on(["message:text", "message:photo", "message:audio", "message:video", "message:document"], async (ctx) => {
    await moderationHandler(ctx);
    await postTracker(ctx);
    await profileHandler(ctx);
    await topHandler(ctx);
    await settingsHandler(ctx); // Добавили обработку текста настроек
});

// Слушаем нажатия inline-кнопок меню настроек
bot.on("callback_query:data", async (ctx) => {
    await settingsCallbackHandler(ctx);
});

bot.on("my_chat_member", async (ctx) => {
    const newStatus = ctx.myChatMember.new_chat_member.status;
    const oldStatus = ctx.myChatMember.old_chat_member.status;

    // Проверяем: если бота только что добавили в чат (он был left/kicked, а стал member или administrator)
    const justAdded = (oldStatus === "left" || oldStatus === "kicked") && 
                      (newStatus === "member" || newStatus === "administrator");

    if (justAdded) {
        // Приветственное сообщение при добавлении в группу
        await ctx.reply(
            `Привет! Я Айк — помощник для рп-чатов.\n\n` +
            `📊 По умолчанию я вывожу статистику прямо в этот чат. Вы можете изменить это в любой момент, введя команду «Настройки Айка».`
        );

        const botMember = ctx.myChatMember.new_chat_member;

        // Проверяем, есть ли уже нужные права (если его добавили сразу как админа)
        const hasPermissions = botMember.status === "administrator" &&
                               botMember.can_restrict_members &&
                               botMember.can_delete_messages;

        if (!hasPermissions) {
            await ctx.reply(
                `⚠️ Для корректной работы Айку нужны права администратора:\n\n` +
                `• Блокировка пользователей\n` +
                `• Удаление сообщений`
            );
        }
    }
});

bot.catch((err) => {
    console.error("Ошибка бота:", err);
});

setupChatMemberHandler(bot);

bot.start({
    allowed_updates: ["message", "callback_query", "chat_member"]
});


// Заглушка для Render, чтобы он видел открытый порт
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot is running');
}).listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});

// Пинг базы данных каждые 2 часа, чтобы Aiven не уходил в спячку
setInterval(async () => {
    try {
        // Делаем самый легкий запрос, например, считаем количество настроек
        await prisma.chatSettings.count();
        console.log("=== [DB Ping] Успешный пинг базы данных для предотвращения сна ===");
    } catch (error) {
        console.error("=== [DB Ping] Ошибка пинга БД:", error);
    }
}, 2 * 60 * 60 * 1000); // 2 часа в миллисекундах

console.log("Бот запущен");
//:)