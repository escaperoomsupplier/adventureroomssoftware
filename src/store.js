import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// Firmware reports the last RFID value, not a durable event sequence. The first
// non-null value is therefore a baseline; an initial placement can be missed.
export class DeviceStore {
  constructor(path) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY, address TEXT NOT NULL, machine_state TEXT,
        software_version TEXT, hardware_version TEXT, last_seen_at TEXT NOT NULL,
        last_rfid TEXT, snapshot_count INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, device_id TEXT NOT NULL,
        type TEXT NOT NULL, uid TEXT NOT NULL, placed INTEGER NOT NULL,
        received_at TEXT NOT NULL
      );`);
  }

  recordDiscovery({ id, address, seenAt = new Date().toISOString() }) {
    this.#identity(id, address);
    if (!Number.isFinite(Date.parse(seenAt))) throw new Error('Invalid discovery timestamp');
    this.db.prepare(`INSERT INTO devices(id,address,last_seen_at) VALUES(?,?,?)
      ON CONFLICT(id) DO UPDATE SET address=excluded.address,last_seen_at=excluded.last_seen_at`)
      .run(String(id), address, new Date(seenAt).toISOString());
    return this.#get(String(id));
  }

  recordSnapshot(snapshot, address) {
    this.#identity(snapshot.id, address);
    const id = String(snapshot.id);
    const rfid = snapshot.rfid;
    if (rfid != null && (typeof rfid.uid !== 'string' || rfid.uid.length > 128 ||
        !rfid.uid.length || typeof rfid.placed !== 'boolean')) throw new Error('Invalid RFID value');
    for (const key of ['machineState', 'softwareVersion', 'hardwareVersion']) {
      if (snapshot[key] != null && !['string', 'number'].includes(typeof snapshot[key])) {
        throw new Error(`Invalid ${key}`);
      }
      if (String(snapshot[key] ?? '').length > 256) throw new Error(`${key} too long`);
    }
    const receivedAt = new Date().toISOString();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const previous = this.#get(id);
      const lastRfid = rfid == null ? previous?.lastRfid ?? null : { uid: rfid.uid, placed: rfid.placed };
      this.db.prepare(`INSERT INTO devices(id,address,machine_state,software_version,hardware_version,last_seen_at,last_rfid,snapshot_count)
        VALUES(?,?,?,?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET
        address=excluded.address,machine_state=excluded.machine_state,software_version=excluded.software_version,
        hardware_version=excluded.hardware_version,last_seen_at=excluded.last_seen_at,
        last_rfid=excluded.last_rfid,snapshot_count=devices.snapshot_count+1`)
        .run(id, address, JSON.stringify(snapshot.machineState ?? null),
          JSON.stringify(snapshot.softwareVersion ?? null), JSON.stringify(snapshot.hardwareVersion ?? null),
          receivedAt, lastRfid ? JSON.stringify(lastRfid) : null);
      let event = null;
      if (rfid != null && !(rfid.uid === '00000000' && !rfid.placed) && previous?.lastRfid &&
          (previous.lastRfid.uid !== rfid.uid || previous.lastRfid.placed !== rfid.placed)) {
        const type = rfid.placed ? 'rfid.placed' : 'rfid.removed';
        const result = this.db.prepare(`INSERT INTO events(device_id,type,uid,placed,received_at) VALUES(?,?,?,?,?)`)
          .run(id, type, rfid.uid, Number(rfid.placed), receivedAt);
        event = { sequence: Number(result.lastInsertRowid), deviceId: id, type,
          uid: rfid.uid, placed: rfid.placed, receivedAt };
      }
      this.db.exec('COMMIT');
      return { device: this.#get(id), event };
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  listDevices() {
    return this.db.prepare('SELECT * FROM devices ORDER BY id').all().map(row => this.#device(row));
  }

  listEvents(limit = 100) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('Event limit must be 1–1000');
    return this.db.prepare(`SELECT sequence,device_id AS deviceId,type,uid,placed,received_at AS receivedAt
      FROM events ORDER BY sequence DESC LIMIT ?`).all(limit)
      .map(row => ({ ...row, placed: Boolean(row.placed) }));
  }

  close() { this.db.close(); }

  #identity(id, address) {
    if (!['string', 'number'].includes(typeof id) || !String(id).length || String(id).length > 128 ||
        typeof address !== 'string' || !address.length || address.length > 256) throw new Error('Invalid device identity');
  }

  #get(id) {
    const row = this.db.prepare('SELECT * FROM devices WHERE id=?').get(id);
    return row ? this.#device(row) : null;
  }

  #device(row) {
    return { id: row.id, address: row.address, machineState: JSON.parse(row.machine_state ?? 'null'),
      softwareVersion: JSON.parse(row.software_version ?? 'null'), hardwareVersion: JSON.parse(row.hardware_version ?? 'null'),
      lastSeenAt: row.last_seen_at, lastRfid: JSON.parse(row.last_rfid ?? 'null'),
      snapshotCount: row.snapshot_count, rfidBaselineEstablished: row.last_rfid !== null };
  }
}
