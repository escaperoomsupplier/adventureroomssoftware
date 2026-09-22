import { randomUUID } from 'node:crypto';

export class RoundStore {
  constructor(db, { now = () => Date.now() } = {}) {
    this.db = db;
    this.now = now;
    db.exec(`CREATE TABLE IF NOT EXISTS rounds (
      id TEXT PRIMARY KEY, roomId TEXT NOT NULL, roomName TEXT NOT NULL, deviceId TEXT NOT NULL,
      sessionId TEXT NOT NULL, teamName TEXT NOT NULL, uid TEXT NOT NULL,
      status TEXT NOT NULL, startedAt TEXT NOT NULL, firstActivityAt TEXT, finishedAt TEXT, reason TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS rounds_active_room ON rounds(roomId) WHERE status='tracking';
    CREATE UNIQUE INDEX IF NOT EXISTS rounds_active_session ON rounds(sessionId) WHERE status='tracking';
    CREATE UNIQUE INDEX IF NOT EXISTS rounds_active_device ON rounds(deviceId) WHERE status='tracking';
    CREATE TABLE IF NOT EXISTS round_scans (
      sequence INTEGER PRIMARY KEY, deviceId TEXT NOT NULL, roomId TEXT, roomName TEXT,
      uid TEXT NOT NULL, sessionId TEXT, teamName TEXT, decision TEXT NOT NULL,
      reason TEXT NOT NULL, receivedAt TEXT NOT NULL
    );`);
    db.exec(`CREATE TEMP TABLE IF NOT EXISTS round_observed_devices(device_id TEXT PRIMARY KEY);
      DELETE FROM round_observed_devices;`);
  }

  applySnapshot({ device, event, previous }) {
    return this.#atomic(() => {
      const time = this.now();
      let changed = this.#reconcile(time, false);
      const baselineRequired = !this.db.prepare('SELECT device_id FROM round_observed_devices WHERE device_id=?').get(device.id) ||
        !previous || time - Date.parse(previous.lastSeenAt) > 25_000;
      this.db.prepare('INSERT OR IGNORE INTO round_observed_devices(device_id) VALUES(?)').run(device.id);
      const active = this.db.prepare("SELECT * FROM rounds WHERE deviceId=? AND status='tracking'").get(device.id);
      if (active) {
        const state = Number(device.machineState);
        const before = previous?.machineState == null ? null : Number(previous.machineState);
        if (baselineRequired) {
          this.#finish(active.id, 'needs_review', !previous || time - Date.parse(previous.lastSeenAt) > 25_000 ?
            'controller_offline' : 'server_restart', time);
          changed = true;
        } else if (state === 3) {
          this.#finish(active.id, 'needs_review', 'controller_programming', time);
          changed = true;
        } else if (state === 2 && (before === 0 || before === 1)) {
          this.#finish(active.id, 'won', 'controller_win', time);
          changed = true;
        } else if (state === 0 && before === 1) {
          this.#finish(active.id, 'interrupted', 'controller_reset', time);
          changed = true;
        } else if (state === 1 && before === 0 && active.firstActivityAt === null) {
          this.db.prepare('UPDATE rounds SET firstActivityAt=? WHERE id=?').run(new Date(time).toISOString(), active.id);
          changed = true;
        }
      }
      if (!event || event.type !== 'rfid.placed' || !event.placed ||
          this.db.prepare('SELECT sequence FROM round_scans WHERE sequence=?').get(event.sequence)) return changed;
      const room = this.db.prepare('SELECT * FROM rooms WHERE device_id=?').get(device.id);
      const session = this.db.prepare(`SELECT s.* FROM reception_bindings b JOIN reception_sessions s
        ON s.id=b.session_id WHERE b.uid=? AND b.released_at IS NULL`).get(event.uid);
      const busyRoom = room && this.db.prepare("SELECT * FROM rounds WHERE roomId=? AND status='tracking'").get(room.id);
      const busyTeam = session && this.db.prepare("SELECT * FROM rounds WHERE sessionId=? AND status='tracking'").get(session.id);
      let reason = !room ? 'unknown_room' : !room.enabled ? 'room_disabled' : !session ? 'unassigned_card' :
        session.ended_at !== null || session.ends_at <= time ? 'inactive_session' :
        baselineRequired ? 'baseline_required' :
        busyRoom?.sessionId === session.id ? 'already_tracking' : busyRoom ? 'room_busy' : busyTeam ? 'team_busy' :
        device.machineState == null || Number(device.machineState) !== 0 ? 'controller_not_ready' : 'tracking_started';
      const decision = reason === 'tracking_started' ? 'accepted' : reason === 'already_tracking' ? 'ignored' : 'rejected';
      this.db.prepare(`INSERT INTO round_scans(sequence,deviceId,roomId,roomName,uid,sessionId,teamName,decision,reason,receivedAt)
        VALUES(?,?,?,?,?,?,?,?,?,?)`).run(event.sequence, device.id, room?.id ?? null, room?.name ?? null,
        event.uid, session?.id ?? null, session?.team_name ?? null, decision, reason, event.receivedAt);
      if (decision === 'accepted') {
        this.db.prepare(`INSERT INTO rounds(id,roomId,roomName,deviceId,sessionId,teamName,uid,status,startedAt)
          VALUES(?,?,?,?,?,?,?,'tracking',?)`).run(randomUUID(), room.id, room.name, device.id,
          session.id, session.team_name, event.uid, new Date(time).toISOString());
      }
      return true;
    });
  }

  reconcile({ restart = false } = {}) {
    return this.#atomic(() => this.#reconcile(this.now(), restart));
  }

  #reconcile(time, restart) {
    let changed = false;
    if (restart) this.db.exec('DELETE FROM round_observed_devices');
    else {
      for (const device of this.db.prepare(`SELECT o.device_id,d.last_seen_at FROM round_observed_devices o
        LEFT JOIN devices d ON d.id=o.device_id`).all()) {
        if (!device.last_seen_at || time - Date.parse(device.last_seen_at) > 25_000) {
          this.db.prepare('DELETE FROM round_observed_devices WHERE device_id=?').run(device.device_id);
        }
      }
    }
    for (const round of this.db.prepare("SELECT * FROM rounds WHERE status='tracking'").all()) {
      const room = this.db.prepare('SELECT * FROM rooms WHERE id=?').get(round.roomId);
      const session = this.db.prepare('SELECT * FROM reception_sessions WHERE id=?').get(round.sessionId);
      const device = this.db.prepare('SELECT last_seen_at FROM devices WHERE id=?').get(round.deviceId);
      const reason = restart ? 'server_restart' : !room || !room.enabled || room.device_id !== round.deviceId ? 'room_changed' :
        !session || session.ended_at !== null ? 'session_ended' : session.ends_at <= time ? 'session_expired' :
        !device || time - Date.parse(device.last_seen_at) > 25_000 ? 'controller_offline' : null;
      if (reason) {
        this.#finish(round.id, reason.startsWith('session_') ? 'closed' : 'needs_review', reason, time);
        changed = true;
      }
    }
    return changed;
  }

  listRounds() {
    return this.db.prepare(`SELECT * FROM rounds WHERE status='tracking' OR id IN
      (SELECT id FROM rounds ORDER BY startedAt DESC,rowid DESC LIMIT 100)
      ORDER BY startedAt DESC,rowid DESC`).all().map(row => ({ ...row }));
  }

  listScans() {
    return this.db.prepare('SELECT * FROM round_scans ORDER BY sequence DESC LIMIT 100').all().map(row => ({ ...row }));
  }

  closeRound(id) {
    if (typeof id !== 'string' || !id.length || id.length > 128) throw Object.assign(new Error('Invalid round ID.'), { status: 400 });
    return this.#atomic(() => {
      const round = this.db.prepare('SELECT * FROM rounds WHERE id=?').get(id);
      if (!round) throw Object.assign(new Error('Round not found.'), { status: 404 });
      if (round.status === 'tracking') this.#finish(id, 'closed', 'operator_closed', this.now());
      return { ...this.db.prepare('SELECT * FROM rounds WHERE id=?').get(id) };
    });
  }

  #finish(id, status, reason, time) {
    this.db.prepare('UPDATE rounds SET status=?,reason=?,finishedAt=? WHERE id=?')
      .run(status, reason, new Date(time).toISOString(), id);
  }

  #atomic(action) {
    this.db.exec('SAVEPOINT round_change');
    try {
      const result = action();
      this.db.exec('RELEASE round_change');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK TO round_change; RELEASE round_change');
      throw error;
    }
  }
}
