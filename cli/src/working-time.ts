import dayjs from 'dayjs';
import isBetween from 'dayjs/plugin/isBetween.js';
import weekOfYear from 'dayjs/plugin/weekOfYear.js';

dayjs.extend(isBetween);
dayjs.extend(weekOfYear);

export interface WorkingTimeConfig {
    startHour: number; // e.g. 9
    endHour: number;   // e.g. 17
    workingDays: number[]; // e.g. [1, 2, 3, 4, 5] (Mon-Fri)
    holidays: string[];    // e.g. ['2026-01-01']
}

export const getWorkingTimeConfig = (): WorkingTimeConfig => {
    return {
        startHour: parseInt(process.env.WORKING_START_HOUR || '9', 10),
        endHour: parseInt(process.env.WORKING_END_HOUR || '17', 10),
        workingDays: (process.env.WORKING_DAYS || '1,2,3,4,5').split(',').map(v => parseInt(v.trim(), 10)),
        holidays: (process.env.HOLIDAYS || '').split(',').map(v => v.trim()).filter(Boolean),
    };
};

/**
 * Calculates working time between two dates in milliseconds.
 * Iterates through days and calculates overlaps with working hours.
 */
export function calculateWorkingTime(
    start: string | Date | dayjs.Dayjs,
    end: string | Date | dayjs.Dayjs,
    config: WorkingTimeConfig = getWorkingTimeConfig()
): number {
    const startDate = dayjs(start);
    const endDate = dayjs(end);

    if (endDate.isBefore(startDate)) return 0;

    let totalMs = 0;
    let current = startDate;

    // Iterate day by day
    while (current.isBefore(endDate) || current.isSame(endDate, 'day')) {
        const isWorkingDay = config.workingDays.includes(current.day()) &&
            !config.holidays.includes(current.format('YYYY-MM-DD'));

        if (isWorkingDay) {
            const dayStart = current.startOf('day').add(config.startHour, 'hour');
            const dayEnd = current.startOf('day').add(config.endHour, 'hour');

            const overlapStart = current.isAfter(dayStart) ? current : dayStart;
            const overlapEnd = endDate.isBefore(dayEnd) ? endDate : dayEnd;

            if (overlapStart.isBefore(overlapEnd)) {
                totalMs += overlapEnd.diff(overlapStart);
            }
        }

        // Move to next day start
        const nextDay = current.add(1, 'day').startOf('day');

        // If we are already at the end date's day, and we've processed it, we can stop
        if (current.isSame(endDate, 'day')) break;

        current = nextDay;
    }

    return totalMs;
}

export function formatWorkingDuration(ms: number): string {
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));

    if (hours === 0) return `${minutes}m`;
    if (minutes === 0) return `${hours}h`;
    return `${hours}h ${minutes}m`;
}
