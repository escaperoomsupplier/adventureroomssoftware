export const readerLabel = reader => `${reader.name || reader.id} · ${reader.port == null ? 'Legacy / port unknown' : `Port ${reader.port}`}`;
export const controllerId = reader => reader.deviceId || reader.id;
