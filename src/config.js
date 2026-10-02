import { DatabaseSync, backup } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { resolve, join, dirname, isAbsolute } from 'node:path';
import { RoomStore } from './rooms.js';

const kinds = ['rooms', 'readers', 'screens', 'rules', 'media'];
const defaults = { schemaVersion: 1, host: '0.0.0.0', port: 4000, discovery: true,
  discoveryBind: '0.0.0.0', discoveryTargets: ['255.255.255.255'] };
const invalid = message => { throw Object.assign(new Error(message), { status: 400 }); };
const read = path => JSON.parse(readFileSync(path, 'utf8'));
function validateSettings(s) {
  if (!s || s.schemaVersion !== 1 || typeof s.host !== 'string' || !s.host || !Number.isInteger(s.port) || s.port < 1 || s.port > 65535 ||
      typeof s.discovery !== 'boolean' || typeof s.discoveryBind !== 'string' || !s.discoveryBind ||
      !Array.isArray(s.discoveryTargets) || !s.discoveryTargets.length || s.discoveryTargets.some(target => typeof target !== 'string' || !target)) invalid('Invalid settings.json.');
  return s;
}
export function readSettings(directory) {
  const path = join(resolve(directory), 'settings.json');
  return validateSettings(existsSync(path) ? read(path) : { ...defaults, discoveryTargets: [...defaults.discoveryTargets] });
}
function atomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
    const fd = openSync(temp, 'r+');
    try { fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temp, path);
  } finally { if (existsSync(temp)) unlinkSync(temp); }
}

export async function prepareConfigDirectory({ directory, legacyDatabasePath } = {}) {
  if (typeof directory !== 'string' || !directory) invalid('Configuration directory is required.');
  const root = resolve(directory);
  for (const path of ['state', 'backups', 'media/audio', 'media/images', 'media/videos']) mkdirSync(join(root, path), { recursive: true });
  const settings = readSettings(root);
  if (!existsSync(join(root, 'settings.json'))) atomic(join(root, 'settings.json'), settings);
  const databasePath = join(root, 'state', 'runtime.sqlite');
  if (!existsSync(databasePath) && legacyDatabasePath && existsSync(legacyDatabasePath) && resolve(legacyDatabasePath) !== databasePath) {
    const source = new DatabaseSync(resolve(legacyDatabasePath), { readOnly: true });
    const temp = `${databasePath}.migration-${randomUUID()}`;
    try {
      await backup(source, temp);
      renameSync(temp, databasePath);
    } finally {
      source.close();
      if (existsSync(temp)) unlinkSync(temp);
    }
  }
  return databasePath;
}

export class PortableConfig {
  constructor(db, directory) {
    this.db = db;
    this.directory = resolve(directory);
    mkdirSync(this.directory, { recursive: true });
    db.exec(`CREATE TABLE IF NOT EXISTS configuration_items(kind TEXT NOT NULL,id TEXT NOT NULL,json TEXT NOT NULL,PRIMARY KEY(kind,id));
      CREATE TABLE IF NOT EXISTS configuration_revision(id INTEGER PRIMARY KEY CHECK(id=1),revision TEXT NOT NULL);`);
    this.settings = { ...defaults };
  }

  initialize({ validateExtras } = {}) {
    this.validateExtras = validateExtras;
    for (const path of ['state', 'backups', 'media/audio', 'media/images', 'media/videos']) mkdirSync(join(this.directory, path), { recursive: true });
    this.#recover();
    const existing = this.#export();
    const bundle = {};
    for (const kind of [...kinds, 'settings']) {
      const path = join(this.directory, `${kind}.json`);
      bundle[kind] = existsSync(path) ? read(path) : existing[kind];
    }
    this.#validate(bundle);
    return this.#commit(() => {
      this.#import(bundle);
      this.validateExtras?.();
      this.settings = bundle.settings;
      return { ...this.settings };
    }, bundle);
  }

  change(action, { validateExtras } = {}) {
    if (typeof action !== 'function') throw new TypeError('Configuration change must be a function.');
    return this.#commit(() => {
      const result = action();
      if (result && typeof result.then === 'function') throw new TypeError('Configuration changes must be synchronous.');
      (validateExtras ?? this.validateExtras)?.();
      return result;
    });
  }

  #export() {
    const items = {};
    items.rooms = this.db.prepare('SELECT id,name,x,y,width,height FROM rooms ORDER BY rowid').all().map(row => ({ ...row }));
    items.readers = this.db.prepare(`SELECT device_id AS id,name,configured,room_id AS roomId,x,y,role FROM reader_settings ORDER BY device_id`).all()
      .map(row => ({ ...row, configured: Boolean(row.configured) }));
    for (const kind of ['screens', 'rules', 'media']) items[kind] = this.db.prepare('SELECT json FROM configuration_items WHERE kind=? ORDER BY id').all(kind).map(row => JSON.parse(row.json));
    return { ...Object.fromEntries(kinds.map(kind => [kind, { schemaVersion: 1, items: items[kind] }])), settings: { ...this.settings } };
  }

  #validate(bundle) {
    for (const kind of kinds) {
      const document = bundle[kind];
      if (!document || document.schemaVersion !== 1 || !Array.isArray(document.items)) invalid(`Invalid ${kind}.json schema.`);
      const ids = new Set();
      for (const item of document.items) {
        if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(item.id) || ids.has(item.id)) invalid(`Invalid or duplicate ${kind} ID.`);
        ids.add(item.id);
      }
    }
    const roomIds = new Set(bundle.rooms.items.map(item => item.id));
    const screenIds = new Set(bundle.screens.items.map(item => item.id));
    const mediaIds = new Set(bundle.media.items.map(item => item.id));
    for (const kind of ['readers', 'screens', 'rules']) for (const item of bundle[kind].items) {
      if (item.roomId != null && !roomIds.has(item.roomId)) invalid(`Unknown room in ${kind}.json.`);
      if (item.screenId != null && !screenIds.has(item.screenId)) invalid(`Unknown screen in ${kind}.json.`);
      if (item.mediaId != null && !mediaIds.has(item.mediaId)) invalid(`Unknown media in ${kind}.json.`);
    }
    for (const media of bundle.media.items) {
      const path = media.path;
      if (typeof path !== 'string' || !path.startsWith('media/') || path.includes('\\') || path.includes(':') || path.includes('\0') ||
          isAbsolute(path) || path.split('/').some(part => part === '..' || part === '.' || !part)) invalid('Media paths must be relative paths inside media/.');
    }
    validateSettings(bundle.settings);
  }

  #import(bundle) {
    // Remove configuration projection only; session and visit snapshots remain intact.
    this.db.exec('DELETE FROM reader_settings; DELETE FROM rooms; DELETE FROM configuration_items;');
    const rooms = new RoomStore(this.db);
    for (const room of bundle.rooms.items) {
      const created = rooms.createRoom(room);
      this.db.prepare('UPDATE rooms SET id=? WHERE id=?').run(room.id, created.id);
    }
    for (const reader of bundle.readers.items) {
      if (!/^[A-Za-z0-9_-]{14}$/.test(reader.id) || typeof reader.name !== 'string' || !reader.name.trim() || reader.name.trim().length > 80 ||
          typeof reader.configured !== 'boolean' || !['entry', 'start', 'stop', 'finish', 'exit', 'pairing', 'other'].includes(reader.role) ||
          !Number.isInteger(reader.x) || reader.x < 0 || reader.x > 10000 || !Number.isInteger(reader.y) || reader.y < 0 || reader.y > 10000) invalid('Invalid reader configuration.');
      this.db.prepare(`INSERT OR IGNORE INTO devices(id,address,last_seen_at) VALUES(?,'','1970-01-01T00:00:00.000Z')`).run(reader.id);
      const room = reader.roomId ? this.db.prepare('SELECT width,height FROM rooms WHERE id=?').get(reader.roomId) : null;
      this.db.prepare('INSERT INTO reader_settings(device_id,name,configured,room_id,x,y,role) VALUES(?,?,?,?,?,?,?)')
        .run(reader.id, reader.name.trim(), Number(reader.configured), reader.roomId ?? null,
          room ? Math.min(reader.x, room.width) : reader.x, room ? Math.min(reader.y, room.height) : reader.y, ({entry:'start',finish:'stop',exit:'stop'})[reader.role] ?? reader.role);
    }
    for (const kind of ['screens', 'rules', 'media']) for (const item of bundle[kind].items) {
      this.db.prepare('INSERT INTO configuration_items(kind,id,json) VALUES(?,?,?)').run(kind, item.id, JSON.stringify(item));
    }
  }

  #commit(action, initialBundle) {
    if (this.db.isTransaction) throw new Error('Configuration changes require a top-level transaction.');
    this.#recover();
    const before = {};
    for (const kind of [...kinds, 'settings']) {
      const path = join(this.directory, `${kind}.json`);
      before[kind] = existsSync(path) ? read(path) : null;
    }
    const previousSettings = this.settings;
    const revision = randomUUID();
    const journal = join(this.directory, '.pending.json');
    this.db.exec('SAVEPOINT portable_configuration');
    let committed = false;
    let result;
    try {
      result = action();
      const next = this.#export();
      if (initialBundle) next.settings = initialBundle.settings;
      this.#validate(next);
      atomic(journal, { revision, before, next });
      atomic(join(this.directory, 'backups', `${revision}.json`), before);
      this.#writeBundle(next);
      this.db.prepare('INSERT INTO configuration_revision(id,revision) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision').run(revision);
      this.db.exec('RELEASE portable_configuration');
      committed = true;
      unlinkSync(journal);
      return result;
    } catch (error) {
      if (committed) return result; // The journal safely completes cleanup on the next operation.
      if (!committed) {
        this.db.exec('ROLLBACK TO portable_configuration; RELEASE portable_configuration');
        this.settings = previousSettings;
        if (existsSync(journal)) { this.#writeBundle(before); unlinkSync(journal); }
      }
      throw error;
    }
  }

  #writeBundle(bundle) {
    for (const kind of [...kinds, 'settings']) {
      const path = join(this.directory, `${kind}.json`);
      if (bundle[kind] === null) { if (existsSync(path)) unlinkSync(path); }
      else atomic(path, bundle[kind]);
    }
  }

  #recover() {
    const journal = join(this.directory, '.pending.json');
    if (!existsSync(journal)) return;
    const pending = read(journal);
    const committed = this.db.prepare('SELECT revision FROM configuration_revision WHERE id=1').get()?.revision === pending.revision;
    this.#writeBundle(committed ? pending.next : pending.before);
    unlinkSync(journal);
  }
}
