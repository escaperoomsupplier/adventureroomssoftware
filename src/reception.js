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
      this.db.prepare(`INSERT INTO reception_sessions(id,team_name,started_at,ends_at) VALUES(?,?,?,?)`)
        .run(id, input.name.trim(), time, time + input.durationMinutes * 60_000);
      return this.#session(this.#row(id), time);
    });
  }

  listSessions() {
    const time = this.now();
    return this.db.prepare('SELECT * FROM reception_sessions ORDER BY started_at DESC, rowid DESC')
      .all().map(row => this.#session(row, time));
  }

  getSession(id) { return this.#session(this.#row(id), this.now()); }

  assignCard(sessionId, uid) {
    uid = this.#uid(uid);
    return this.#transaction(time => {
      const row = this.#row(sessionId);
      if (row.ended_at !== null || row.ends_at <= time) fail(409, 'Cards can only be assigned to active sessions.');
      const previous = this.db.prepare(`SELECT b.id,b.session_id,s.ends_at,s.ended_at
        FROM reception_bindings b JOIN reception_sessions s ON s.id=b.session_id
        WHERE b.uid=? AND b.released_at IS NULL`).get(uid);
      if (previous) {
        if (previous.session_id === sessionId) return this.#session(row, time);
        if (previous.ended_at === null && previous.ends_at > time) fail(409, 'Card is already assigned to another active session.');
        this.db.prepare('UPDATE reception_bindings SET released_at=? WHERE id=?')
          .run(previous.ended_at ?? previous.ends_at, previous.id);
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
        .run(Math.min(time, row.ended_at ?? row.ends_at), sessionId, uid);
      return this.#session(row, time);
    });
  }

  endSession(sessionId) {
    return this.#transaction(time => {
      const row = this.#row(sessionId);
      if (row.ended_at === null) {
        this.db.prepare('UPDATE reception_sessions SET ended_at=? WHERE id=?').run(time, sessionId);
        this.db.prepare('UPDATE reception_bindings SET released_at=? WHERE session_id=? AND released_at IS NULL')
          .run(Math.min(time, row.ends_at), sessionId);
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
    const status = row.ended_at !== null ? 'ended' : row.ends_at <= time ? 'expired' : 'active';
    const cards = status === 'active' ? this.db.prepare(`SELECT uid FROM reception_bindings
      WHERE session_id=? AND released_at IS NULL ORDER BY id`).all(row.id).map(binding => binding.uid) : [];
    return { id: row.id, teamName: row.team_name, startedAt: new Date(row.started_at).toISOString(),
      endsAt: new Date(row.ends_at).toISOString(), status, cards };
  }

  #transaction(action) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = action(this.now());
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}
