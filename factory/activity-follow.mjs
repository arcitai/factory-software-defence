import { setTimeout as delay } from 'node:timers/promises';
import { activityQuery } from './activity.mjs';

// One request at a time; reconnect always retains the exact attempt and cursor.
export async function followActivity({ request, job, attempt, after = null, limit = '50', follow = false,
  interval = 2000, signal, output, unavailable }) {
  let { cursor } = activityQuery(after, limit);
  if (!Number.isSafeInteger(interval) || interval < 1000 || interval > 30000) throw new Error('Activity poll interval must be 1000–30000 ms');
  do {
    if (signal?.aborted) return;
    try {
      const page = await request(`/api/v1/jobs/${job}/runs/${attempt}/activity?limit=${limit}${cursor === null ? '' : `&after=${cursor}`}`, signal);
      if (signal?.aborted) return;
      output(page); cursor = page.next_cursor;
      if (!follow || (page.terminal && !page.has_more)) return;
    } catch (error) {
      if (signal?.aborted) return;
      if (!follow || /Controller 4\d\d:/.test(error.message)) throw error;
      unavailable({ status: 'unavailable', job, attempt, next_cursor: cursor, refreshed_at: null });
    }
    try { await delay(interval, undefined, { signal }); } catch { if (signal?.aborted) return; }
  } while (follow);
}
