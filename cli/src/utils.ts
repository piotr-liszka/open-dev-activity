import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime.js';
import duration from 'dayjs/plugin/duration.js';

dayjs.extend(relativeTime);
dayjs.extend(duration);

export const formatDate = (dateStr: string): string => {
    return dayjs(dateStr).format('YYYY-MM-DD HH:mm:ss');
};

export const getDuration = (ms: number): string => {
    return dayjs.duration(ms).humanize();
};

export const parseDateInput = (input?: string): dayjs.Dayjs => {
    if (!input) return dayjs();
    return dayjs(input);
};
