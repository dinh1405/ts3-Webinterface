/**
 * Läuft vor jedem Server-Testmodul: frisches Daten- und Backup-Verzeichnis, feste Umgebung,
 * keine .env-Datei. Die Servermodule binden diese Werte beim Import, deshalb muss das hier
 * geschehen, bevor ein Test ein Modul aus server/ lädt (in den Tests immer dynamisch importieren).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll } from 'vitest';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ts3wi-test-'));
process.env.DATA_DIR = path.join(root, 'data');
process.env.BACKUP_DIR = path.join(root, 'backups');
process.env.ENV_FILE = path.join(root, 'no.env');
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-1234';
process.env.HOST = '127.0.0.1';
process.env.PORT = '0';
process.env.LOGIN_RATE_MAX = '5';
process.env.UI_LANGUAGE = 'en';
process.env.TS3WI_TEST_ROOT = root;
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
fs.mkdirSync(process.env.BACKUP_DIR, { recursive: true });

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
