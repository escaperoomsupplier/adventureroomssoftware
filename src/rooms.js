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
    const columns = new Set(db.prepare('PRAGMA table_info(rooms)').all().map(c => c.name));
    for (const [key, value] of Object.entries({ x: 0, y: 0, width: 240, height: 160 })) {
      if (!columns.has(key)) db.exec(`ALTER TABLE rooms ADD COLUMN ${key} INTEGER NOT NULL DEFAULT ${value}`);
    }
  }

  createRoom(input) {
    const values = this.#validate(input, true);
    return this.#transaction(() => {
      this.#checkDevice(values.deviceId);
      const id = randomUUID();
      const time = new Date().toISOString();
      this.db.prepare(`INSERT INTO rooms(id,name,device_id,enabled,created_at,updated_at,x,y,width,height)
        VALUES(?,?,?,?,?,?,?,?,?,?)`).run(id, values.name, values.deviceId, Number(values.enabled), time, time, values.x, values.y, values.width, values.height);
      return this.getRoom(id);
    });
  }

  updateRoom(id, input) {
    return this.#transaction(() => {
      if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, 'Invalid room update.');
      const values = this.#validate({ ...this.getRoom(id), ...input }, false);
      this.#checkDevice(values.deviceId, id);
      this.db.prepare('UPDATE rooms SET name=?,device_id=?,enabled=?,updated_at=?,x=?,y=?,width=?,height=? WHERE id=?')
        .run(values.name, values.deviceId, Number(values.enabled), new Date().toISOString(), values.x, values.y, values.width, values.height, id);
      if (this.db.prepare("SELECT name FROM sqlite_master WHERE name='reader_settings'").get()) {
        this.db.prepare('UPDATE reader_settings SET x=MIN(x,?),y=MIN(y,?) WHERE room_id=?').run(values.width, values.height, id);
      }
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
    const geometry = {};
    for (const [key, [fallback, min, max]] of Object.entries({ x: [0,0,10000], y: [0,0,10000], width: [240,120,2000], height: [160,80,2000] })) {
      const value = defaults && input[key] === undefined ? fallback : input[key];
      if (!Number.isInteger(value) || value < min || value > max) fail(400, `Invalid room ${key}.`);
      geometry[key] = value;
    }
    return { name: input.name.trim(), deviceId, enabled, ...geometry };
  }

  #checkDevice(deviceId, roomId = null) {
    if (deviceId === null) return;
    if (!this.db.prepare('SELECT id FROM devices WHERE id=?').get(deviceId)) fail(400, 'Controller is not known.');
    const existing = this.db.prepare('SELECT id FROM rooms WHERE device_id=?').get(deviceId);
    if (existing && existing.id !== roomId) fail(409, 'Controller is already assigned to another room.');
  }

  #room(row) {
    return { id: row.id, name: row.name, deviceId: row.device_id, enabled: Boolean(row.enabled),
      createdAt: row.created_at, updatedAt: row.updated_at, x: row.x, y: row.y, width: row.width, height: row.height };
  }

  #transaction(action) {
    this.db.exec('SAVEPOINT room_change');
    try {
      const result = action();
      this.db.exec('RELEASE room_change');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK TO room_change; RELEASE room_change');
      throw error;
    }
  }
}
