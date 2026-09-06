import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

/**
 * Kleiner JSON-Dateispeicher mit atomarem Schreiben (tmp + rename)
 * und serialisierten Schreibvorgängen.
 *
 * Schreibfehler werden an den Aufrufer weitergereicht (`set()`/`update()` lehnen ab) und der
 * Speicherzustand fällt auf den zuletzt erfolgreich geschriebenen Stand zurück, damit die API
 * nie Werte zeigt, die nach einem Neustart fehlen würden.
 */
export class JsonStore {
  constructor(file, defaults) {
    this.file = file;
    this.defaults = defaults;
    this.data = undefined;
    this.committed = null; // JSON-Text des zuletzt gelesenen/geschriebenen Stands
    this.queue = Promise.resolve();
    this.pending = 0;
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
      const text = fs.readFileSync(this.file, 'utf8');
      this.data = JSON.parse(text);
      this.committed = text;
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      this.data = structuredClone(this.defaults);
      this.committed = null;
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

  /** Verwirft ungeschriebene Änderungen und stellt den zuletzt gespeicherten Stand wieder her. */
  revert() {
    this.data = this.committed === null ? structuredClone(this.defaults) : JSON.parse(this.committed);
  }

  flush() {
    const json = JSON.stringify(this.data, null, 2);
    this.pending += 1;
    const run = this.queue.then(async () => {
      await fsp.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      await fsp.writeFile(tmp, json, { mode: 0o600 });
      await fsp.rename(tmp, this.file);
      this.mtime = (await fsp.stat(this.file)).mtimeMs;
      this.committed = json;
    });
    const settled = run.then(
      () => { this.pending -= 1; },
      (e) => {
        this.pending -= 1;
        // Nur zurücksetzen, wenn kein neuerer Schreibvorgang mehr aussteht – der entscheidet sonst selbst.
        if (this.pending === 0) this.revert();
        console.error(`[store] writing ${this.file} failed:`, e.message);
        const err = new Error(`cannot write ${path.basename(this.file)}: ${e.message}`);
        err.code = 'STORE_WRITE';
        err.file = this.file;
        err.cause = e;
        throw err;
      },
    );
    // Die Warteschlange selbst darf nie in den Fehlerzustand kippen
    this.queue = settled.catch(() => {});
    return settled;
  }
}
