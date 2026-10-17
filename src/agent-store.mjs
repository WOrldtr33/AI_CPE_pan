import { mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, readdirSync, openSync, closeSync, fsyncSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { timestamp } from './time.mjs';

const validId = id => typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id);

// 独立于 Codex 的记忆目录；只保存本 Demo 的用户记忆、会话及任务。
export class AgentStore {
  constructor(directory, sanitize = value => value) {
    Object.assign(this, { directory, sanitize });
    mkdirSync(join(directory, 'tasks'), { recursive: true });
    this.lockPath = join(directory, 'lock.json');
    this.lockId = randomUUID();
    try {
      this.acquireLock();
      this.recoverInterrupted();
    } catch (error) { this.close(); throw error; }
  }
  acquireLock() {
    for (let attempt = 0; attempt < 2; attempt++) {
      let fd;
      try {
        fd = openSync(this.lockPath, 'wx');
        writeFileSync(fd, JSON.stringify({ pid: process.pid, id: this.lockId }));
        fsyncSync(fd); closeSync(fd); return;
      } catch (error) {
        if (fd !== undefined) closeSync(fd);
        if (error.code !== 'EEXIST') throw error;
        const lock = this.read('lock.json');
        if (!Number.isInteger(lock?.pid)) throw new Error('STATE_LOCK_INVALID');
        try { process.kill(lock.pid, 0); }
        catch (check) {
          if (check.code === 'ESRCH') { unlinkSync(this.lockPath); continue; }
          throw new Error('STATE_LOCKED：该设备已有 Agent 进程在运行。');
        }
        throw new Error('STATE_LOCKED：该设备已有 Agent 进程在运行。');
      }
    }
    throw new Error('STATE_LOCKED');
  }
  close() {
    try { if (this.read('lock.json')?.id === this.lockId) unlinkSync(this.lockPath); }
    catch { /* 不覆盖原错误，也不移除其他进程的锁。 */ }
  }
  read(file, fallback = null) {
    try { return JSON.parse(readFileSync(join(this.directory, file), 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT') return fallback;
      throw new Error(`STATE_READ_FAILED_${file}`);
    }
  }
  save(file, value) {
    const path = join(this.directory, file), temp = `${path}.${randomUUID()}.tmp`;
    let fd;
    try {
      fd = openSync(temp, 'wx', 0o600);
      writeFileSync(fd, JSON.stringify(this.sanitize(value), null, 2));
      fsyncSync(fd); closeSync(fd); fd = undefined;
      renameSync(temp, path);
    } finally {
      if (fd !== undefined) closeSync(fd);
      try { unlinkSync(temp); } catch { /* rename 已完成。 */ }
    }
  }
  session() { return this.read('session.json'); }
  saveSession(context) { this.save('session.json', { version: 1, updatedAt: timestamp(), ...context }); }
  tasks() {
    return readdirSync(join(this.directory, 'tasks')).filter(name => /^[a-f0-9-]{36}\.json$/.test(name))
      .map(name => this.read(`tasks/${name}`)).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }
  task(id) {
    if (!validId(id)) throw new Error('INVALID_TASK_ID');
    const task = this.read(`tasks/${id}.json`);
    if (!task) throw new Error('TASK_NOT_FOUND');
    return task;
  }
  createTask(input, parentId = null) {
    const task = { id: randomUUID(), createdAt: timestamp(), updatedAt: timestamp(), status: 'running', input, parentId, steps: [], proposals: [] };
    this.saveTask(task); return task;
  }
  saveTask(task) {
    if (!validId(task.id)) throw new Error('INVALID_TASK_ID');
    task.updatedAt = timestamp(); this.save(`tasks/${task.id}.json`, task);
  }
  recoverInterrupted() {
    for (const task of this.tasks()) {
      if (['running', 'executing_write'].includes(task.status)) {
        task.status = 'interrupted';
        task.recovery = task.writeDispatch ? 'readback_required_no_replay' : 'read_only_replan';
        this.saveTask(task);
      }
    }
  }
  propose(task, name, args) {
    const existing = task.proposals.find(p => p.name === name && JSON.stringify(p.args) === JSON.stringify(args) && p.status === 'pending');
    if (existing) return existing;
    if (task.proposals.length) throw new Error('ONE_WRITE_PER_TASK：一次任务只允许一个写提案，请先处理现有提案。');
    const proposal = { id: randomUUID(), name, args, status: 'pending', createdAt: timestamp() };
    task.proposals.push(proposal); this.saveTask(task); return proposal;
  }
  proposal(id) {
    if (!validId(id)) throw new Error('INVALID_PROPOSAL_ID');
    for (const task of this.tasks()) {
      const proposal = task.proposals.find(p => p.id === id);
      if (proposal) return { task, proposal };
    }
    throw new Error('PROPOSAL_NOT_FOUND');
  }
  cancel(id) {
    const task = this.task(id);
    if (task.writeDispatch || ['completed', 'reconciled', 'resumed'].includes(task.status)) throw new Error('TASK_CANNOT_CANCEL：已结束任务不能撤销，已提交写操作只能回读核实。');
    task.status = 'cancelled';
    for (const p of task.proposals) if (p.status === 'pending') p.status = 'cancelled';
    this.saveTask(task); return task;
  }
  memories() { return this.read('memory.json', { items: [] }).items; }
  remember(text) {
    if (typeof text !== 'string' || !text.trim() || text.length > 500) throw new Error('MEMORY_LENGTH_LIMIT：记忆须为 1–500 字符。');
    if (/密码|口令|密钥|password|passwd|api.?key|authorization|cookie|session|\btoken\b|\bsecret\b|sk-/i.test(text)) throw new Error('MEMORY_CREDENTIAL_REJECTED：不保存凭据类记忆。');
    const items = this.memories();
    if (items.length >= 50) throw new Error('MEMORY_COUNT_LIMIT');
    const item = { id: randomUUID(), text: this.sanitize(text.trim()), createdAt: timestamp(), source: 'user_command' };
    items.push(item); this.save('memory.json', { items }); return item;
  }
  forget(id) {
    const items = this.memories(), remaining = items.filter(item => item.id !== id);
    if (remaining.length === items.length) throw new Error('MEMORY_NOT_FOUND');
    this.save('memory.json', { items: remaining });
  }
}
