import { randomUUID } from 'node:crypto';

function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}

export class ReceptionStore {
  constructor(db, { now = () => Date.now() } = {}) {
    this.db = db;
    this.now = now;
    db.exec(`CREATE TABLE IF NOT EXISTS reception_sessions (
      id TEXT PRIMARY KEY, team_name TEXT NOT NULL, started_at INTEGER NOT NULL,
      ends_at INTEGER NOT NULL, ended_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS reception_bindings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES reception_sessions(id),
      uid TEXT NOT NULL, assigned_at INTEGER NOT NULL, released_at INTEGER
    );
    CREATE UNIQUE INDEX IF NOT EXISTS reception_current_uid
      ON reception_bindings(uid) WHERE released_at IS NULL;
    CREATE INDEX IF NOT EXISTS reception_session_bindings
      ON reception_bindings(session_id);`);
    const columns = new Set(db.prepare('PRAGMA table_info(reception_sessions)').all().map(c => c.name));
    for (const [name, definition] of Object.entries({ pending: 'INTEGER NOT NULL DEFAULT 0', created_at: 'INTEGER',
      duration_minutes: 'INTEGER', terminal_status: 'TEXT', current_room_id: 'TEXT', current_room_name: 'TEXT', expiry_notified: 'INTEGER NOT NULL DEFAULT 0' })) {
      if (!columns.has(name)) db.exec(`ALTER TABLE reception_sessions ADD COLUMN ${name} ${definition}`);
    }
    db.exec(`UPDATE reception_sessions SET created_at=started_at WHERE created_at IS NULL;
      UPDATE reception_sessions SET duration_minutes=MAX(1,(ends_at-started_at)/60000) WHERE duration_minutes IS NULL;
      UPDATE reception_sessions SET terminal_status='cancelled' WHERE ended_at IS NOT NULL AND terminal_status IS NULL;
      CREATE TABLE IF NOT EXISTS game_results(id TEXT PRIMARY KEY,session_id TEXT NOT NULL UNIQUE,
        team_name TEXT NOT NULL,started_at INTEGER NOT NULL,finished_at INTEGER NOT NULL,elapsed_ms INTEGER NOT NULL,hidden INTEGER NOT NULL DEFAULT 0);`);
  }

  createSession(input) {
    if (!input || typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 80) {
      fail(400, 'Team name must contain 1 to 80 characters.');
    }
    if (!Number.isInteger(input.durationMinutes) || input.durationMinutes < 1 || input.durationMinutes > 720) {
      fail(400, 'Duration must be an integer between 1 and 720 minutes.');
    }
    return this.#transaction(time => {
      const id = randomUUID();
      this.db.prepare(`INSERT INTO reception_sessions(id,team_name,started_at,ends_at,pending,created_at,duration_minutes) VALUES(?,?,?,?,1,?,?)`)
        .run(id, input.name.trim(), time, time, time, input.durationMinutes);
      return this.#session(this.#row(id), time);
    });
  }

  listSessions() {
    const time = this.now();
    return this.db.prepare('SELECT * FROM reception_sessions ORDER BY created_at DESC, rowid DESC')
      .all().map(row => this.#session(row, time));
  }

  getSession(id) { return this.#session(this.#row(id), this.now()); }

  startSession(id) {
    return this.#transaction(time => {
      const row = this.#row(id);
      const status = this.#status(row, time);
      if (status === 'active') return this.#session(row, time);
      if (status !== 'pending') fail(409, 'Only pending sessions can be started.');
      this.db.prepare('UPDATE reception_sessions SET pending=0,started_at=?,ends_at=? WHERE id=?')
        .run(time, time + row.duration_minutes * 60000, id);
      return this.#session(this.#row(id), time);
    });
  }

  assignCard(sessionId, uid) {
    uid = this.#uid(uid);
    return this.#transaction(time => {
      const row = this.#row(sessionId);
      if (!['pending', 'active'].includes(this.#status(row, time))) fail(409, 'Cards can only be assigned to pending or active sessions.');
      const previous = this.db.prepare(`SELECT b.id AS binding_id,b.session_id,s.*
        FROM reception_bindings b JOIN reception_sessions s ON s.id=b.session_id
        WHERE b.uid=? AND b.released_at IS NULL`).get(uid);
      if (previous) {
        if (previous.session_id === sessionId) return this.#session(row, time);
        if (['pending', 'active'].includes(this.#status(previous, time))) fail(409, 'Card is already assigned to another pending or active session.');
        this.db.prepare('UPDATE reception_bindings SET released_at=? WHERE id=?')
          .run(previous.ended_at ?? previous.ends_at, previous.binding_id);
      }
      this.db.prepare('INSERT INTO reception_bindings(session_id,uid,assigned_at) VALUES(?,?,?)')
        .run(sessionId, uid, time);
      return this.#session(row, time);
    });
  }

  releaseCard(sessionId, uid) {
    uid = this.#uid(uid);
    return this.#transaction(time => {
      const row = this.#row(sessionId);
      this.db.prepare(`UPDATE reception_bindings SET released_at=?
        WHERE session_id=? AND uid=? AND released_at IS NULL`)
        .run(row.pending ? time : Math.min(time, row.ended_at ?? row.ends_at), sessionId, uid);
      return this.#session(row, time);
    });
  }

  endSession(sessionId) {
    return this.#transaction(time => {
      const row = this.#row(sessionId);
      const status = this.#status(row, time);
      if (status === 'pending' || status === 'active') {
        this.db.prepare('UPDATE reception_sessions SET ended_at=?,terminal_status=? WHERE id=?').run(time, status === 'pending' ? 'cancelled' : 'finished', sessionId);
        if (status === 'active') this.db.prepare(`INSERT OR IGNORE INTO game_results(id,session_id,team_name,started_at,finished_at,elapsed_ms)
          VALUES(?,?,?,?,?,?)`).run(randomUUID(), sessionId, row.team_name, row.started_at, time, Math.max(0, time-row.started_at));
        this.db.prepare('UPDATE reception_bindings SET released_at=? WHERE session_id=? AND released_at IS NULL')
          .run(time, sessionId);
      }
      return this.#session(this.#row(sessionId), time);
    });
  }

  #uid(uid) {
    if (typeof uid !== 'string' || !/^[\da-f]{8}$/i.test(uid) || uid === '00000000') {
      fail(400, 'Card UID must contain exactly 8 hexadecimal characters and cannot be 00000000.');
    }
    return uid.toUpperCase();
  }

  #row(id) {
    if (typeof id !== 'string' || !id.length || id.length > 128) fail(400, 'Invalid session ID.');
    const row = this.db.prepare('SELECT * FROM reception_sessions WHERE id=?').get(id);
    if (!row) fail(404, 'Session not found.');
    return row;
  }

  #session(row, time) {
    const status = this.#status(row, time);
    const cards = ['pending', 'active'].includes(status) ? this.db.prepare(`SELECT uid FROM reception_bindings
      WHERE session_id=? AND released_at IS NULL ORDER BY id`).all(row.id).map(binding => binding.uid) : [];
    return { id: row.id, teamName: row.team_name, durationMinutes: row.duration_minutes,
      createdAt: new Date(row.created_at).toISOString(), startedAt: row.pending ? null : new Date(row.started_at).toISOString(),
      endsAt: row.pending ? null : new Date(row.ends_at).toISOString(),
      finishedAt: row.ended_at === null ? null : new Date(row.ended_at).toISOString(),
      elapsedMs: row.pending ? 0 : Math.max(0, Math.min(row.ended_at ?? time, row.ends_at)-row.started_at),
      currentRoomId: row.current_room_id, currentRoomName: row.current_room_name, status, cards };
  }

  #status(row, time) { return row.terminal_status ?? (row.pending ? 'pending' : row.ends_at <= time ? 'expired' : 'active'); }

  #transaction(action) {
    this.db.exec('SAVEPOINT reception_change');
    try {
      const result = action(this.now());
      this.db.exec('RELEASE reception_change');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK TO reception_change; RELEASE reception_change');
      throw error;
    }
  }
}
