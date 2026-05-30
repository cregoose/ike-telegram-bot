export function parseTime(text: string) {
    let hours = 0;
    let minutes = 0;

    const hoursMatch = text.match(
        /(\d+)\s*(час|часа|часов)/i
    );

    if (hoursMatch) {
        hours = parseInt(hoursMatch[1]!);
    }

    const minutesMatch = text.match(
        /(\d+)\s*(минута|минуты|минут|мин)/i
    );

    if (minutesMatch) {
        minutes = parseInt(minutesMatch[1]!);
    }

    if (hours === 0 && minutes === 0) {
        hours = 1;
    }

    return {
        hours,
        minutes,
    };
}