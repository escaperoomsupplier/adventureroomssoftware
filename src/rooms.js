import { randomUUID } from 'node:crypto';

function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}

export class RoomStore {
  constructor(db) {
    this.db = db;
    db.exec(`CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY, name TEXT NOT NULL,
      device_id TEXT UNIQUE REFERENCES devices(id),
      enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );`);
  }

  createRoom(input) {
    const values = this.#validate(input, true);
    return this.#transaction(() => {
      this.#checkDevice(values.deviceId);
      const id = randomUUID();
      const time = new Date().toISOString();
      this.db.prepare(`INSERT INTO rooms(id,name,device_id,enabled,created_at,updated_at)
        VALUES(?,?,?,?,?,?)`).run(id, values.name, values.deviceId, Number(values.enabled), time, time);
      return this.getRoom(id);
    });
  }

  updateRoom(id, input) {
    const values = this.#validate(input, false);
    return this.#transaction(() => {
      this.getRoom(id);
      this.#checkDevice(values.deviceId, id);
      this.db.prepare('UPDATE rooms SET name=?,device_id=?,enabled=?,updated_at=? WHERE id=?')
        .run(values.name, values.deviceId, Number(values.enabled), new Date().toISOString(), id);
      return this.getRoom(id);
    });
  }

  getRoom(id) {
    if (typeof id !== 'string' || !id.length || id.length > 128) fail(400, 'Invalid room ID.');
    const row = this.db.prepare('SELECT * FROM rooms WHERE id=?').get(id);
    if (!row) fail(404, 'Room not found.');
    return this.#room(row);
  }

  listRooms() {
    return this.db.prepare('SELECT * FROM rooms ORDER BY created_at, rowid').all().map(row => this.#room(row));
  }

  #validate(input, defaults) {
    if (!input || typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 80) {
      fail(400, 'Room name must contain 1 to 80 characters.');
    }
    const deviceId = defaults && input.deviceId === undefined ? null : input.deviceId;
    const enabled = defaults && input.enabled === undefined ? true : input.enabled;
    if (deviceId !== null && (typeof deviceId !== 'string' || !/^[A-Za-z0-9_-]{14}$/.test(deviceId))) {
      fail(400, 'Controller ID must contain exactly 14 ASCII letters, digits, underscores or hyphens.');
    }
    if (typeof enabled !== 'boolean') fail(400, 'Enabled must be a boolean.');
    return { name: input.name.trim(), deviceId, enabled };
  }

  #checkDevice(deviceId, roomId = null) {
    if (deviceId === null) return;
    if (!this.db.prepare('SELECT id FROM devices WHERE id=?').get(deviceId)) fail(400, 'Controller is not known.');
    const existing = this.db.prepare('SELECT id FROM rooms WHERE device_id=?').get(deviceId);
    if (existing && existing.id !== roomId) fail(409, 'Controller is already assigned to another room.');
  }

  #room(row) {
    return { id: row.id, name: row.name, deviceId: row.device_id, enabled: Boolean(row.enabled),
      createdAt: row.created_at, updatedAt: row.updated_at };
  }

  #transaction(action) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = action();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}
