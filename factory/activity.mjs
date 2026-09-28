// Private execution observations, never evidence, usage or action authority.
import { open, rename, rm } from 'node:fs/promises';
import { constants, fstatSync, lstatSync, openSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';

export const ACTIVITY_CAP = 128;
export const ACTIVITY_BYTES = 64 * 1024;
export const ACTIVITY_LINE_BYTES = 64 * 1024;
export const ACTIVITY_KINDS = Object.freeze(['phase_started', 'process_started', 'message_completed',
  'tool_completed', 'process_exited', 'phase_completed', 'phase_error']);
export const TOOL_CATEGORIES = Object.freeze(['read', 'edit', 'command', 'search', 'other']);
const phases = ['build', 'verify', 'review', 'handoff', 'defence'];
const timestamp = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value));
const integer = value => Number.isSafeInteger(value) && value >= 0;
const keys = (value, allowed) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => allowed.includes(key));
const increment = value => Math.min(Number.MAX_SAFE_INTEGER, value + 1);
const codexTools = { command_execution: 'command', file_change: 'edit', web_search: 'search', mcp_tool_call: 'other' };
const piTools = { read: 'read', write: 'edit', edit: 'edit', bash: 'command', grep: 'search', find: 'search', ls: 'read' };

// Independent from usage parsing: strict UTF-8 JSONL, no tail fragments, no raw
// input retained after each line, and a fixed buffer even for newline-free output.
export class ActivityParser {
  constructor(harness, emit, received = () => {}, lost = () => {}) {
    this.harness = harness; this.emit = emit; this.received = received; this.lost = lost;
    this.buffer = Buffer.alloc(ACTIVITY_LINE_BYTES); this.length = 0; this.overflow = false;
    this.decoder = new TextDecoder('utf-8', { fatal: true });
  }
  write(chunk) {
    if (!chunk.length) return;
    this.received();
    if (!['codex', 'pi'].includes(this.harness)) return;
    for (const byte of chunk) {
      if (byte === 10) { this.complete(); continue; }
      if (this.length < this.buffer.length) this.buffer[this.length++] = byte;
      else this.overflow = true;
    }
  }
  complete() {
    try {
      if (this.overflow) throw new Error();
      if (!this.length) return;
      const event = JSON.parse(this.decoder.decode(this.buffer.subarray(0, this.length)));
      if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error();
      if (this.harness === 'codex' && event.type === 'item.completed') {
        const type = event.item?.type;
        if (type === 'agent_message') this.emit('message_completed');
        else if (Object.hasOwn(codexTools, type)) this.emit('tool_completed', codexTools[type]);
      }
      if (this.harness === 'pi') {
        if (event.type === 'message_end' && event.message?.role === 'assistant') this.emit('message_completed');
        if (event.type === 'tool_execution_end' && typeof event.toolName === 'string')
          this.emit('tool_completed', Object.hasOwn(piTools, event.toolName) ? piTools[event.toolName] : 'other');
      }
    } catch { this.lost(); }
    finally { this.buffer.fill(0, 0, this.length); this.length = 0; this.overflow = false; }
  }
  finish() {
    if (this.length || this.overflow) this.lost();
    this.buffer.fill(0); this.length = 0; this.overflow = false;
  }
}

export class ActivityWriter {
  constructor(directory, { job, attempt, phase, harness }, { interval = 1000 } = {}) {
    this.path = join(directory, 'activity.json'); this.interval = interval;
    this.record = { version: 1, job, attempt, phase, support: ['codex', 'pi'].includes(harness) ? harness : 'unsupported',
      cursor: 0, dropped: 0, rejected: 0, write_errors: 0, last_received_at: null, process_observation: null, process_observed_at: null, saved_at: null, events: [] };
    this.dirty = false; this.pending = null; this.timer = null; this.closed = false;
    this.parser = new ActivityParser(harness, (kind, tool) => this.emit(kind, tool),
      () => { this.record.last_received_at = new Date().toISOString(); this.schedule(); },
      () => { this.record.rejected = increment(this.record.rejected); this.schedule(); });
    this.emit('phase_started');
  }
  emit(kind, tool) {
    if (!ACTIVITY_KINDS.includes(kind) || (tool !== undefined && !TOOL_CATEGORIES.includes(tool))) throw new Error('Invalid activity category');
    if (this.record.cursor === Number.MAX_SAFE_INTEGER) { this.record.rejected = increment(this.record.rejected); this.schedule(); return; }
    if (['process_started', 'process_exited'].includes(kind)) {
      this.record.process_observation = kind; this.record.process_observed_at = new Date().toISOString();
    }
    this.record.events.push({ cursor: ++this.record.cursor, at: new Date().toISOString(), kind, ...(tool ? { tool } : {}) });
    if (this.record.events.length > ACTIVITY_CAP) { this.record.events.shift(); this.record.dropped++; }
    this.schedule();
  }
  schedule() {
    this.dirty = true;
    if (!this.closed && !this.timer) this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, this.interval);
  }
  async flush() {
    if (this.pending) { await this.pending; return; }
    if (!this.dirty) return;
    this.dirty = false;
    const snapshot = JSON.stringify({ ...this.record, saved_at: new Date().toISOString() });
    // At most one write in flight; clients never trigger writes. A fixed temp
    // name and atomic replacement bound disk usage to two capped records.
    this.pending = (async () => {
      let handle;
      try {
        handle = await open(`${this.path}.tmp`, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600);
        await handle.chmod(0o600); await handle.writeFile(snapshot); await handle.sync(); await handle.close(); handle = null;
        await rename(`${this.path}.tmp`, this.path);
      } catch {
        this.record.write_errors = increment(this.record.write_errors); this.dirty = true;
        await handle?.close().catch(() => {}); await rm(`${this.path}.tmp`, { force: true }).catch(() => {});
      }
    })();
    await this.pending; this.pending = null;
    if (this.dirty && !this.closed) this.schedule();
  }
  async finish(success) {
    if (this.closed) return;
    this.closed = true; clearTimeout(this.timer); this.timer = null;
    this.parser.finish(); this.emit(success ? 'phase_completed' : 'phase_error');
    await this.pending; await this.flush();
  }
}

export function activityQuery(after, limit = '50') {
  if (after !== null && after !== undefined && !/^(0|[1-9]\d{0,15})$/.test(String(after))) throw Object.assign(new Error('Invalid activity cursor'), { status: 400 });
  const cursor = after == null ? null : Number(after), count = Number(limit);
  if ((cursor !== null && !integer(cursor)) || !/^[1-9]\d{0,2}$/.test(String(limit)) || !integer(count) || count > ACTIVITY_CAP)
    throw Object.assign(new Error('Invalid activity cursor or limit'), { status: 400 });
  return { cursor, limit: count };
}

export function readActivity(state, job, attempt, query = activityQuery(null)) {
  if (!/^job_[a-f0-9]+$/.test(job.id) || !/^run_[a-f0-9]+$/.test(attempt.id) || !phases.includes(attempt.command))
    throw Object.assign(new Error('Activity identity unavailable'), { status: 400 });
  const terminal = ['succeeded', 'failed', 'cancelled', 'interrupted'].includes(attempt.state);
  const result = { version: 1, job: job.id, attempt: attempt.id, phase: attempt.command,
    attempt_state: attempt.state, terminal, container_health: 'unknown', refreshed_at: new Date().toISOString(),
    status: 'unavailable', support: 'unknown', events: [], next_cursor: query.cursor ?? 0,
    latest_cursor: null, oldest_cursor: null, truncated: false, has_more: false,
    last_received_at: null, process_observation: null, process_observed_at: null, phase_started_at: timestamp(attempt.started_at) ? attempt.started_at : null,
    saved_at: null, dropped: 0, rejected: 0, write_errors: 0, completion_observed: false };
  let record, fd;
  try {
    const folder = join(state, 'jobs', job.id, attempt.id);
    for (const dir of [join(state, 'jobs'), join(state, 'jobs', job.id), folder]) {
      const stat = lstatSync(dir);
      if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077)) throw new Error();
    }
    fd = openSync(join(folder, 'activity.json'), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile() || (stat.mode & 0o077) || stat.size > ACTIVITY_BYTES) throw new Error();
    const buffer = Buffer.alloc(ACTIVITY_BYTES + 1), size = readSync(fd, buffer, 0, buffer.length, 0);
    if (size > ACTIVITY_BYTES) throw new Error();
    record = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size)));
    if (!keys(record, ['version','job','attempt','phase','support','cursor','dropped','rejected','write_errors','last_received_at','process_observation','process_observed_at','saved_at','events'])
      || record.version !== 1 || record.job !== job.id || record.attempt !== attempt.id || record.phase !== attempt.command
      || !['codex','pi','unsupported'].includes(record.support) || !integer(record.cursor) || !integer(record.dropped)
      || !integer(record.rejected) || !integer(record.write_errors) || !timestamp(record.saved_at)
      || (record.last_received_at !== null && !timestamp(record.last_received_at))
      || (record.process_observation === null ? record.process_observed_at !== null
        : !['process_started','process_exited'].includes(record.process_observation) || !timestamp(record.process_observed_at))
      || !Array.isArray(record.events) || !record.events.length || record.events.length > ACTIVITY_CAP
      || record.cursor !== record.dropped + record.events.length) throw new Error();
    for (const [index, event] of record.events.entries()) {
      if (!keys(event, ['cursor','at','kind','tool']) || event.cursor !== record.dropped + index + 1
        || !timestamp(event.at) || !ACTIVITY_KINDS.includes(event.kind)
        || (event.kind === 'tool_completed' ? !TOOL_CATEGORIES.includes(event.tool) : event.tool !== undefined)) throw new Error();
    }
  } catch (error) { result.status = error.code === 'ENOENT' ? 'unavailable' : 'error'; return result; }
  finally { if (fd !== undefined) closeSync(fd); }
  if (query.cursor !== null && query.cursor > record.cursor) throw Object.assign(new Error('Activity cursor is ahead of retained history; reconnect with the same attempt and no cursor'), { status: 409 });
  const start = query.cursor ?? Math.max(record.dropped, record.cursor - query.limit);
  const events = record.events.filter(event => event.cursor > start).slice(0, query.limit);
  return { ...result, status: 'available', support: record.support, events,
    next_cursor: events.at(-1)?.cursor ?? start, latest_cursor: record.cursor, oldest_cursor: record.dropped + 1,
    truncated: start < record.dropped || (query.cursor === null && start > 0),
    has_more: (events.at(-1)?.cursor ?? start) < record.cursor,
    last_received_at: record.last_received_at, process_observation: record.process_observation, process_observed_at: record.process_observed_at, saved_at: record.saved_at,
    dropped: record.dropped, rejected: record.rejected, write_errors: record.write_errors,
    completion_observed: ['phase_completed', 'phase_error'].includes(record.events.at(-1)?.kind) };
}
