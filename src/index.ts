import { Bot } from "grammy";
import dotenv from "dotenv";

import { moderationHandler } from "./commands/moderation";
import { postTracker } from "./handlers/postTracker";
import { profileHandler } from "./commands/profile";
import { topHandler } from "./commands/top";

dotenv.config();

const bot = new Bot(process.env.BOT_TOKEN!);

/*bot.use(async (ctx, next) => {
    console.log(ctx.message);
    await next();
});*/

bot.command("start", async (ctx) => {
    await ctx.reply("Бот работает!");
});

bot.on("message", async (ctx) => {
    await moderationHandler(ctx);
    await postTracker(ctx);
    await profileHandler(ctx);
    await topHandler(ctx);
});

bot.on("my_chat_member", async (ctx) => {
    const newStatus = ctx.myChatMember.new_chat_member.status;
    const oldStatus = ctx.myChatMember.old_chat_member.status;

    // Проверяем: если бота только что добавили в чат (он был left/kicked, а стал member или administrator)
    const justAdded = (oldStatus === "left" || oldStatus === "kicked") && 
                      (newStatus === "member" || newStatus === "administrator");

    if (justAdded) {
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
    console.error("Ошибка бота:");
});

bot.start();

console.log("Бот запущен");
//:)