import { randomUUID } from 'node:crypto';
import { ReceptionStore } from './reception.js';

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };

export class VenueStore {
  constructor(db, { now = () => Date.now() } = {}) {
    this.db = db;
    this.now = now;
    this.reception = new ReceptionStore(db, { now });
    db.exec(`CREATE TABLE IF NOT EXISTS reader_settings(device_id TEXT PRIMARY KEY REFERENCES devices(id),
      name TEXT NOT NULL,configured INTEGER NOT NULL,room_id TEXT REFERENCES rooms(id),x INTEGER NOT NULL,y INTEGER NOT NULL,role TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS venue_migrations(name TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS venue_processed_events(sequence INTEGER PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS team_visits(id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES reception_sessions(id),
        room_id TEXT NOT NULL,room_name TEXT NOT NULL,reader_id TEXT NOT NULL,reader_name TEXT NOT NULL,entered_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS team_visits_session ON team_visits(session_id);
      CREATE TEMP TABLE IF NOT EXISTS venue_observed_devices(device_id TEXT PRIMARY KEY);
      DELETE FROM venue_observed_devices;`);
    const columns = new Set(db.prepare('PRAGMA table_info(team_visits)').all().map(c => c.name));
    if (!columns.has('exited_at')) db.exec('ALTER TABLE team_visits ADD COLUMN exited_at INTEGER');
    if (!columns.has('exit_reason')) db.exec('ALTER TABLE team_visits ADD COLUMN exit_reason TEXT');
    db.exec(`CREATE TABLE IF NOT EXISTS venue_events(sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,session_id TEXT NOT NULL,room_id TEXT NOT NULL,occurred_at INTEGER NOT NULL,source TEXT NOT NULL);`);
    this.#atomic(() => {
      if (!db.prepare("SELECT name FROM venue_migrations WHERE name='legacy_rooms'").get()) {
        db.exec(`INSERT OR IGNORE INTO reader_settings(device_id,name,configured,room_id,x,y,role)
          SELECT device_id,device_id,1,id,20,20,'entry' FROM rooms WHERE device_id IS NOT NULL;
          INSERT INTO venue_migrations(name) VALUES('legacy_rooms');`);
      }
    });
  }

  listReaders() {
    return this.db.prepare(`SELECT d.*,s.name,s.configured,s.room_id,s.x,s.y,s.role,o.device_id AS observed FROM devices d
      LEFT JOIN reader_settings s ON s.device_id=d.id
      LEFT JOIN venue_observed_devices o ON o.device_id=d.id ORDER BY d.id`).all().map(row => ({
      id: row.id, address: row.address, lastSeenAt: row.last_seen_at, machineState: JSON.parse(row.machine_state ?? 'null'),
      softwareVersion: JSON.parse(row.software_version ?? 'null'), hardwareVersion: JSON.parse(row.hardware_version ?? 'null'),
      lastRfid: JSON.parse(row.last_rfid ?? 'null'), snapshotCount: row.snapshot_count,
      rfidBaselineEstablished: row.observed !== null && row.last_rfid !== null && this.now() - Date.parse(row.last_seen_at) <= 25000,
      name: row.name ?? row.id, configured: Boolean(row.configured),
      roomId: row.room_id ?? null, x: row.x ?? 20, y: row.y ?? 20, role: row.role ?? 'entry' }));
  }

  updateReader(id, input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, 'Invalid reader update.');
    return this.#atomic(() => {
      const reader = this.listReaders().find(item => item.id === id);
      if (!reader) fail(404, 'Reader not found.');
      const values = { ...reader, ...input };
      if (typeof values.name !== 'string' || !values.name.trim() || values.name.trim().length > 80) fail(400, 'Reader name must contain 1 to 80 characters.');
      if (typeof values.configured !== 'boolean') fail(400, 'Configured must be a boolean.');
      if (!['entry', 'start', 'finish', 'exit'].includes(values.role)) fail(400, 'Invalid reader role.');
      for (const key of ['x', 'y']) if (!Number.isInteger(values[key]) || values[key] < 0 || values[key] > 10000) fail(400, `Invalid reader ${key}.`);
      let room = null;
      if (values.roomId !== null) {
        if (typeof values.roomId !== 'string') fail(400, 'Invalid room ID.');
        room = this.db.prepare('SELECT * FROM rooms WHERE id=?').get(values.roomId);
        if (!room) fail(400, 'Room not found.');
      }
      this.db.prepare(`INSERT INTO reader_settings(device_id,name,configured,room_id,x,y,role) VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(device_id) DO UPDATE SET name=excluded.name,configured=excluded.configured,room_id=excluded.room_id,
        x=excluded.x,y=excluded.y,role=excluded.role`).run(id, values.name.trim(), Number(values.configured), values.roomId,
        room ? Math.min(values.x, room.width) : values.x, room ? Math.min(values.y, room.height) : values.y, values.role);
      return this.listReaders().find(item => item.id === id);
    });
  }

  applySnapshot({ device, event, previous }) {
    return this.#atomic(() => {
      let changed = this.reconcile();
      const baseline = !this.db.prepare('SELECT device_id FROM venue_observed_devices WHERE device_id=?').get(device.id) ||
        !previous || this.now() - Date.parse(previous.lastSeenAt) > 25000;
      this.db.prepare('INSERT OR IGNORE INTO venue_observed_devices(device_id) VALUES(?)').run(device.id);
      if (!event || event.type !== 'rfid.placed' || !event.placed) return changed;
      if (this.db.prepare('SELECT sequence FROM venue_processed_events WHERE sequence=?').get(event.sequence)) return changed;
      this.db.prepare('INSERT INTO venue_processed_events(sequence) VALUES(?)').run(event.sequence);
      if (baseline) return changed;
      const reader = this.db.prepare('SELECT * FROM reader_settings WHERE device_id=? AND configured=1').get(device.id);
      if (!reader) return changed;
      const room = reader.room_id ? this.db.prepare('SELECT * FROM rooms WHERE id=?').get(reader.room_id) : null;
      if (reader.room_id && !room) return changed;
      const binding = this.db.prepare('SELECT session_id FROM reception_bindings WHERE uid=? AND released_at IS NULL').get(event.uid);
      if (!binding) return changed;
      let session = this.reception.getSession(binding.session_id);
      if (reader.role === 'start' && session.status === 'pending') {
        session = this.reception.startSession(session.id);
        changed = true;
      }
      if (session.status !== 'active') return changed;
      if (reader.role === 'exit') {
        if (room && session.currentRoomId === room.id) {
          this.#exitVisit(session.id, room.id, 'reader_exit');
          this.db.prepare('UPDATE reception_sessions SET current_room_id=NULL,current_room_name=NULL WHERE id=?').run(session.id);
          this.#event('room.exited', session.id, room.id, 'reader');
          return true;
        }
        return changed;
      }
      if (room && session.currentRoomId !== room.id) {
        if (session.currentRoomId) this.#exitVisit(session.id, session.currentRoomId, 'next_room');
        this.db.prepare(`INSERT INTO team_visits(id,session_id,room_id,room_name,reader_id,reader_name,entered_at)
          VALUES(?,?,?,?,?,?,?)`).run(randomUUID(), session.id, room.id, room.name, device.id, reader.name, this.now());
        this.db.prepare('UPDATE reception_sessions SET current_room_id=?,current_room_name=? WHERE id=?').run(room.id, room.name, session.id);
        this.#event('room.entered', session.id, room.id, 'reader');
        changed = true;
      }
      if (reader.role === 'finish') {
        this.reception.endSession(session.id);
        changed = true;
      }
      return changed;
    });
  }

  reconcile({ restart = false } = {}) {
    return this.#atomic(() => {
      if (restart) this.db.exec('DELETE FROM venue_observed_devices');
      for (const device of this.db.prepare(`SELECT o.device_id,d.last_seen_at FROM venue_observed_devices o
        LEFT JOIN devices d ON d.id=o.device_id`).all()) {
        if (!device.last_seen_at || this.now() - Date.parse(device.last_seen_at) > 25000) {
          this.db.prepare('DELETE FROM venue_observed_devices WHERE device_id=?').run(device.device_id);
        }
      }
      const expired = this.db.prepare(`SELECT id,ends_at FROM reception_sessions
        WHERE pending=0 AND terminal_status IS NULL AND ends_at<=? AND expiry_notified=0`).all(this.now());
      for (const row of expired) {
        this.db.prepare('UPDATE reception_sessions SET expiry_notified=1 WHERE id=?').run(row.id);
        this.db.prepare('UPDATE reception_bindings SET released_at=? WHERE session_id=? AND released_at IS NULL').run(row.ends_at, row.id);
      }
      return expired.length > 0;
    });
  }

  getHistory(sessionId) {
    this.reception.getSession(sessionId);
    return this.db.prepare(`SELECT id,room_id AS roomId,room_name AS roomName,reader_id AS readerId,
      reader_name AS readerName,entered_at AS enteredAt,exited_at AS exitedAt,exit_reason AS exitReason FROM team_visits WHERE session_id=? ORDER BY entered_at,rowid`).all(sessionId)
      .map(row => ({ ...row, enteredAt: new Date(row.enteredAt).toISOString(), exitedAt: row.exitedAt === null ? null : new Date(row.exitedAt).toISOString() }));
  }

  listDomainEvents(afterSequence = 0) {
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) fail(400, 'Invalid event cursor.');
    return this.db.prepare(`SELECT id,sequence,type,session_id AS sessionId,room_id AS roomId,occurred_at AS occurredAt,source
      FROM venue_events WHERE sequence>? ORDER BY sequence`).all(afterSequence)
      .map(row => ({ ...row, occurredAt: new Date(row.occurredAt).toISOString() }));
  }

  #exitVisit(sessionId, roomId, reason) {
    this.db.prepare('UPDATE team_visits SET exited_at=?,exit_reason=? WHERE session_id=? AND room_id=? AND exited_at IS NULL')
      .run(this.now(), reason, sessionId, roomId);
  }

  #event(type, sessionId, roomId, source) {
    this.db.prepare('INSERT INTO venue_events(id,type,session_id,room_id,occurred_at,source) VALUES(?,?,?,?,?,?)')
      .run(randomUUID(), type, sessionId, roomId, this.now(), source);
  }

  listLeaderboard() {
    return this.db.prepare(`SELECT id,session_id AS sessionId,team_name AS teamName,started_at AS startedAt,
      finished_at AS finishedAt,elapsed_ms AS elapsedMs FROM game_results WHERE hidden=0 ORDER BY elapsed_ms,finished_at,rowid`).all()
      .map(row => ({ ...row, startedAt: new Date(row.startedAt).toISOString(), finishedAt: new Date(row.finishedAt).toISOString() }));
  }

  deleteLeaderboard(id) {
    if (typeof id !== 'string' || !id.length || id.length > 128) fail(400, 'Invalid result ID.');
    return this.#atomic(() => {
      if (!this.db.prepare('SELECT id FROM game_results WHERE id=?').get(id)) fail(404, 'Result not found.');
      this.db.prepare('UPDATE game_results SET hidden=1 WHERE id=?').run(id);
      return { id, deleted: true };
    });
  }

  #atomic(action) {
    this.db.exec('SAVEPOINT venue_change');
    try {
      const result = action();
      this.db.exec('RELEASE venue_change');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK TO venue_change; RELEASE venue_change');
      throw error;
    }
  }
}
