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
      ON reception_bindings(session_id);
    CREATE TABLE IF NOT EXISTS venue_events(sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,session_id TEXT NOT NULL,room_id TEXT NOT NULL,occurred_at INTEGER NOT NULL,source TEXT NOT NULL);`);
    const columns = new Set(db.prepare('PRAGMA table_info(reception_sessions)').all().map(c => c.name));
    for (const [name, definition] of Object.entries({ pending: 'INTEGER NOT NULL DEFAULT 0', created_at: 'INTEGER',
      duration_minutes: 'INTEGER', terminal_status: 'TEXT', current_room_id: 'TEXT', current_room_name: 'TEXT', expiry_notified: 'INTEGER NOT NULL DEFAULT 0', team_id: 'TEXT' })) {
      if (!columns.has(name)) db.exec(`ALTER TABLE reception_sessions ADD COLUMN ${name} ${definition}`);
    }
    db.exec(`UPDATE reception_sessions SET created_at=started_at WHERE created_at IS NULL;
      UPDATE reception_sessions SET duration_minutes=MAX(1,(ends_at-started_at)/60000) WHERE duration_minutes IS NULL;
      UPDATE reception_sessions SET terminal_status='cancelled' WHERE ended_at IS NOT NULL AND terminal_status IS NULL;
      CREATE TABLE IF NOT EXISTS room_times(session_id TEXT NOT NULL REFERENCES reception_sessions(id),room_id TEXT NOT NULL,
        room_name TEXT NOT NULL,started_at INTEGER NOT NULL,stopped_at INTEGER,PRIMARY KEY(session_id,room_id));
      CREATE TABLE IF NOT EXISTS game_results(id TEXT PRIMARY KEY,session_id TEXT NOT NULL UNIQUE,
        team_name TEXT NOT NULL,started_at INTEGER NOT NULL,finished_at INTEGER NOT NULL,elapsed_ms INTEGER NOT NULL,hidden INTEGER NOT NULL DEFAULT 0);`);
    const resultColumns = new Set(db.prepare('PRAGMA table_info(game_results)').all().map(c => c.name));
    if (!resultColumns.has('timing_version')) db.exec('ALTER TABLE game_results ADD COLUMN timing_version INTEGER NOT NULL DEFAULT 0');
    if (!resultColumns.has('team_id')) db.exec('ALTER TABLE game_results ADD COLUMN team_id TEXT');
    if (!db.prepare('PRAGMA table_info(venue_events)').all().some(column => column.name === 'reader_id')) db.exec('ALTER TABLE venue_events ADD COLUMN reader_id TEXT');
    db.exec(`CREATE TABLE IF NOT EXISTS team_profiles(id TEXT PRIMARY KEY,name TEXT NOT NULL,created_at INTEGER NOT NULL);
      INSERT OR IGNORE INTO team_profiles(id,name,created_at) SELECT id,team_name,created_at FROM reception_sessions WHERE team_id IS NULL;
      UPDATE reception_sessions SET team_id=id WHERE team_id IS NULL;
      UPDATE game_results SET team_id=(SELECT team_id FROM reception_sessions WHERE id=game_results.session_id) WHERE team_id IS NULL;
      CREATE INDEX IF NOT EXISTS reception_team_id ON reception_sessions(team_id);
      CREATE INDEX IF NOT EXISTS results_team_id ON game_results(team_id);`);
    db.exec(`CREATE TABLE IF NOT EXISTS room_results(id TEXT PRIMARY KEY,result_id TEXT NOT NULL REFERENCES game_results(id),
      room_id TEXT NOT NULL,room_name TEXT NOT NULL,started_at INTEGER NOT NULL,stopped_at INTEGER NOT NULL,elapsed_ms INTEGER NOT NULL);
      UPDATE reception_sessions SET pending=1,current_room_id=NULL,current_room_name=NULL
      WHERE terminal_status IS NULL AND NOT EXISTS(SELECT 1 FROM room_times WHERE session_id=reception_sessions.id);`);
  }

  createSession(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, 'Invalid team.');
    if (input.teamId !== undefined && (typeof input.teamId !== 'string' || !input.teamId || input.teamId.length > 128)) fail(400, 'Invalid team ID.');
    if (input.teamId === undefined && (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 80)) {
      fail(400, 'Team name must contain 1 to 80 characters.');
    }
    return this.#transaction(time => {
      const id = randomUUID();
      let profile;
      if (input.teamId !== undefined) {
        profile = this.db.prepare('SELECT * FROM team_profiles WHERE id=?').get(input.teamId);
        if (!profile) fail(404, 'Team not found.');
        if (this.db.prepare('SELECT id FROM reception_sessions WHERE team_id=? AND terminal_status IS NULL').get(profile.id)) fail(409, 'This team already has a pending or active run.');
      } else {
        profile = { id: randomUUID(), name: input.name.trim() };
        this.db.prepare('INSERT INTO team_profiles(id,name,created_at) VALUES(?,?,?)').run(profile.id, profile.name, time);
      }
      this.db.prepare(`INSERT INTO reception_sessions(id,team_name,started_at,ends_at,pending,created_at,duration_minutes,team_id) VALUES(?,?,?,?,1,?,?,?)`)
        .run(id, profile.name, time, time, time, 0, profile.id);
      return this.#session(this.#row(id), time);
    });
  }

  listSessions() {
    const time = this.now();
    return this.db.prepare('SELECT * FROM reception_sessions ORDER BY created_at DESC, rowid DESC')
      .all().map(row => this.#session(row, time));
  }

  getSession(id) { return this.#session(this.#row(id), this.now()); }

  listTeams(query = '') {
    if (typeof query !== 'string' || query.length > 200) fail(400, 'Invalid team search.');
    const search = query.trim().toLocaleLowerCase();
    return this.db.prepare('SELECT * FROM team_profiles ORDER BY name COLLATE NOCASE,id').all()
      .filter(profile => profile.name.toLocaleLowerCase().includes(search))
      .map(profile => ({ id: profile.id, name: profile.name,
        lastResult: this.#teamResult(profile.id, 'finished_at DESC,rowid DESC'),
        bestResult: this.#teamResult(profile.id, 'elapsed_ms,finished_at,rowid'),
        previousResult: this.#teamResult(profile.id, 'finished_at DESC,rowid DESC', true),
        activeSessionId: this.db.prepare('SELECT id FROM reception_sessions WHERE team_id=? AND terminal_status IS NULL ORDER BY created_at DESC,rowid DESC LIMIT 1').get(profile.id)?.id ?? null }));
  }

  #teamResult(teamId, order, visible = false, excludeSessionId = '') {
    const result = this.db.prepare(`SELECT id,session_id AS sessionId,team_id AS teamId,elapsed_ms AS elapsedMs,
      finished_at AS finishedAt,hidden FROM game_results WHERE team_id=? AND timing_version=1 AND session_id<>?
      ${visible ? 'AND hidden=0' : ''} ORDER BY ${order} LIMIT 1`).get(teamId, excludeSessionId);
    return result ? { ...result, hidden: Boolean(result.hidden), finishedAt: new Date(result.finishedAt).toISOString() } : null;
  }

  startSession(id, room, reader) {
    if (!room) fail(409, 'Start a room using its start reader.');
    this.startRoom(id, room, reader);
    return this.getSession(id);
  }

  startRoom(id, room, reader = { id: '', name: '' }) {
    return this.#transaction(time => {
      const row = this.#row(id);
      const status = this.#status(row, time);
      if (!['pending', 'active'].includes(status)) return false;
      if (!room || typeof room.id !== 'string' || typeof room.name !== 'string') fail(400, 'A room is required.');
      if (this.db.prepare('SELECT 1 FROM room_times WHERE session_id=? AND room_id=?').get(id, room.id)) return false;
      this.db.prepare('INSERT INTO room_times(session_id,room_id,room_name,started_at) VALUES(?,?,?,?)').run(id, room.id, room.name, time);
      if (status === 'pending') {
        this.db.prepare('UPDATE reception_sessions SET pending=0,started_at=? WHERE id=?').run(time, id);
        this.#lifecycle('team.started', { ...row, current_room_id: room.id }, time, 'started');
      }
      this.db.prepare('UPDATE reception_sessions SET current_room_id=?,current_room_name=? WHERE id=?').run(room.id, room.name, id);
      if (this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='team_visits'").get()) {
        this.db.prepare('INSERT INTO team_visits(id,session_id,room_id,room_name,reader_id,reader_name,entered_at) VALUES(?,?,?,?,?,?,?)')
          .run(randomUUID(), id, room.id, room.name, reader.id, reader.name, time);
      }
      this.#lifecycle('room.entered', { ...row, current_room_id: room.id }, time, 'reader');
      return true;
    });
  }

  stopRoom(id, room) {
    return this.#transaction(time => {
      const row = this.#row(id);
      if (this.#status(row, time) !== 'active') return false;
      const result = this.db.prepare('UPDATE room_times SET stopped_at=? WHERE session_id=? AND room_id=? AND stopped_at IS NULL').run(time, id, room.id);
      if (!result.changes) return false;
      if (this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='team_visits'").get()) {
        this.db.prepare("UPDATE team_visits SET exited_at=?,exit_reason='reader_stop' WHERE session_id=? AND room_id=? AND exited_at IS NULL").run(time, id, room.id);
      }
      const current = this.db.prepare('SELECT room_id,room_name FROM room_times WHERE session_id=? AND stopped_at IS NULL ORDER BY started_at DESC,rowid DESC LIMIT 1').get(id);
      this.db.prepare('UPDATE reception_sessions SET current_room_id=?,current_room_name=? WHERE id=?').run(current?.room_id ?? null, current?.room_name ?? null, id);
      this.#lifecycle('room.exited', { ...row, current_room_id: room.id }, time, 'reader');
      return true;
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
        .run(time, sessionId, uid);
      return this.#session(row, time);
    });
  }

  endSession(sessionId, options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options) || (options.replaceResult !== undefined && typeof options.replaceResult !== 'boolean')) fail(400, 'Replace result must be a boolean.');
    return this.#transaction(time => {
      const row = this.#row(sessionId);
      const status = this.#status(row, time);
      if (status === 'finished') return this.#session(row, time);
      if (status !== 'active') fail(409, 'Only a team with completed room times can be saved.');
      const times = this.db.prepare('SELECT * FROM room_times WHERE session_id=?').all(sessionId);
      if (!times.length || times.some(room => room.stopped_at === null)) fail(409, 'Complete at least one room and stop every running room timer before saving.');
      const previous = this.#teamResult(row.team_id, 'finished_at DESC,rowid DESC', true, sessionId);
      if (previous && typeof options.replaceResult !== 'boolean') fail(409, 'This team has a saved ranking. Choose whether to replace it or keep the previous result.');
      if (previous && options.replaceResult) this.db.prepare('UPDATE game_results SET hidden=1 WHERE team_id=? AND hidden=0').run(row.team_id);
      const resultId = randomUUID();
      this.db.prepare('UPDATE reception_sessions SET ended_at=?,terminal_status=\'finished\' WHERE id=?').run(time, sessionId);
      this.db.prepare(`INSERT INTO game_results(id,session_id,team_name,started_at,finished_at,elapsed_ms,timing_version,team_id,hidden)
        VALUES(?,?,?,?,?,?,1,?,?)`).run(resultId, sessionId, row.team_name, row.started_at, time, times.reduce((sum, room) => sum + Math.max(0, room.stopped_at-room.started_at), 0), row.team_id, Number(Boolean(previous && !options.replaceResult)));
      const insert = this.db.prepare('INSERT INTO room_results(id,result_id,room_id,room_name,started_at,stopped_at,elapsed_ms) VALUES(?,?,?,?,?,?,?)');
      for (const room of times) insert.run(randomUUID(), resultId, room.room_id, room.room_name, room.started_at, room.stopped_at, Math.max(0, room.stopped_at-room.started_at));
      this.#lifecycle('team.ended', row, time, 'finished');
      this.db.prepare('UPDATE reception_bindings SET released_at=? WHERE session_id=? AND released_at IS NULL').run(time, sessionId);
      return this.#session(this.#row(sessionId), time);
    });
  }

  resetSession(id) {
    return this.#transaction(time => {
      const row = this.#row(id);
      if (!['pending', 'active'].includes(this.#status(row, time))) fail(409, 'Only pending or active teams can be reset.');
      this.db.prepare('DELETE FROM room_times WHERE session_id=?').run(id);
      if (this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='team_visits'").get()) this.db.prepare('DELETE FROM team_visits WHERE session_id=?').run(id);
      this.db.prepare('UPDATE reception_sessions SET pending=1,started_at=?,ends_at=?,current_room_id=NULL,current_room_name=NULL WHERE id=?').run(time, time, id);
      return this.#session(this.#row(id), time);
    });
  }

  cancelSession(id) {
    return this.#transaction(time => {
      const row = this.#row(id);
      if (this.#status(row, time) === 'cancelled') return this.#session(row, time);
      if (!['pending', 'active'].includes(this.#status(row, time))) fail(409, 'Only pending or active teams can be cancelled.');
      this.db.prepare("UPDATE reception_sessions SET terminal_status='cancelled',ended_at=?,current_room_id=NULL,current_room_name=NULL WHERE id=?").run(time, id);
      this.db.prepare('UPDATE room_times SET stopped_at=? WHERE session_id=? AND stopped_at IS NULL').run(time, id);
      if (this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='team_visits'").get()) {
        this.db.prepare("UPDATE team_visits SET exited_at=?,exit_reason='cancelled' WHERE session_id=? AND exited_at IS NULL").run(time, id);
      }
      this.db.prepare('UPDATE reception_bindings SET released_at=? WHERE session_id=? AND released_at IS NULL').run(time, id);
      return this.#session(this.#row(id), time);
    });
  }

  reconcileExpiry() { return false; }

  #lifecycle(type, row, time, source) {
    this.db.prepare('INSERT OR IGNORE INTO venue_events(id,type,session_id,room_id,occurred_at,source) VALUES(?,?,?,?,?,?)')
      .run(randomUUID(), type, row.id, row.current_room_id ?? '', time, source);
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
    const roomTimes = this.db.prepare('SELECT * FROM room_times WHERE session_id=? ORDER BY started_at,rowid').all(row.id).map(room => ({
      roomId: room.room_id, roomName: room.room_name, startedAt: new Date(room.started_at).toISOString(),
      stoppedAt: room.stopped_at === null ? null : new Date(room.stopped_at).toISOString(),
      elapsedMs: Math.max(0, (room.stopped_at ?? row.ended_at ?? time)-room.started_at)
    }));
    return { id: row.id, teamId: row.team_id, teamName: row.team_name, roomTimes,
      previousResult: this.#teamResult(row.team_id, 'finished_at DESC,rowid DESC', true, row.id),
      createdAt: new Date(row.created_at).toISOString(), startedAt: row.pending ? null : new Date(row.started_at).toISOString(),
      endsAt: null,
      finishedAt: row.ended_at === null ? null : new Date(row.ended_at).toISOString(),
      elapsedMs: roomTimes.reduce((sum, room) => sum + room.elapsedMs, 0),
      currentRoomId: row.current_room_id, currentRoomName: row.current_room_name, status, cards };
  }

  #status(row, time) { return row.terminal_status ?? (row.pending ? 'pending' : 'active'); }

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
