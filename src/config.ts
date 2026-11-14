import path from 'node:path';

export const DATA_DIR = path.resolve(process.env.DATA_DIR ?? 'data');
export const PORT = Number(process.env.PORT ?? 4600);

// "Today" for every date window. Defaults to the newest answer in the feed so the sample data
// always looks current. Set NOW=YYYY-MM-DD to pin it.
export const NOW_OVERRIDE = process.env.NOW ?? null;
