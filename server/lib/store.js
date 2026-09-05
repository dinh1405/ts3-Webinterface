import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

/**
 * Kleiner JSON-Dateispeicher mit atomarem Schreiben (tmp + rename)
 * und serialisierten Schreibvorgängen.
 */
export class JsonStore {
  constructor(file, defaults) {
    this.file = file;
    this.defaults = defaults;
    this.data = undefined;
    this.queue = Promise.resolve();
  }

  load() {
    // Datei neu einlesen, wenn sie von außen geändert wurde (z. B. durch das create-admin-CLI)
    let mtime = 0;
    try {
      mtime = fs.statSync(this.file).mtimeMs;
    } catch {
      mtime = 0;
    }
    if (this.data !== undefined && mtime === this.mtime) return this.data;
    try {
      this.data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      this.data = structuredClone(this.defaults);
    }
    this.mtime = mtime;
    return this.data;
  }

  get() {
    return this.load();
  }

  async set(value) {
    this.data = value;
    await this.flush();
    return value;
  }

  async update(fn) {
    const current = this.load();
    const result = fn(current);
    this.data = result === undefined ? current : result;
    await this.flush();
    return this.data;
  }

  flush() {
    const json = JSON.stringify(this.data, null, 2);
    this.queue = this.queue
      .then(async () => {
        await fsp.mkdir(path.dirname(this.file), { recursive: true });
        const tmp = `${this.file}.${process.pid}.tmp`;
        await fsp.writeFile(tmp, json, { mode: 0o600 });
        await fsp.rename(tmp, this.file);
        this.mtime = (await fsp.stat(this.file)).mtimeMs;
      })
      .catch((e) => console.error(`[store] writing ${this.file} failed:`, e));
    return this.queue;
  }
}
