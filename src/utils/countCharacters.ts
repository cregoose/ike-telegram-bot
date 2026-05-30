export function countCharacters(
    text: string
) {
    let cleaned = text;

    // Удаляем всё после //
    cleaned = cleaned.split("//")[0]!;

    // Удаляем всё после \\
    cleaned = cleaned.split("\\\\")[0]!;

    return cleaned.trim().length;
}