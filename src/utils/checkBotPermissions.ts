import { Context } from "grammy";

export async function checkBotPermissions(
    ctx: Context
) {
    const bot = await ctx.getChatMember(
        ctx.me.id
    );

    const permissions = [
        "can_restrict_members",
        "can_delete_messages",
        "can_promote_members",
    ];

    for (const permission of permissions) {
        if (!(bot as any)[permission]) {
            return false;
        }
    }

    return true;
}