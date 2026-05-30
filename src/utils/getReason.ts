export function getReason(text: string) {
    const lines = text.split("\n");

    if (lines.length > 1) {
        return lines.slice(1).join("\n");
    }

    return "Не указана";
}