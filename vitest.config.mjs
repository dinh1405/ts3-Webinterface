import { defineConfig } from 'vitest/config';

/**
 * Servertests laufen je Datei in einem eigenen Prozess (pool: forks, isolate), weil viele Module
 * DATA_DIR/BACKUP_DIR beim Import binden. test/server/setup.mjs legt vor jedem Testmodul ein
 * frisches Datenverzeichnis an und setzt die Umgebung.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'server',
          environment: 'node',
          include: ['test/server/**/*.test.mjs'],
          setupFiles: ['test/server/setup.mjs'],
          pool: 'forks',
          isolate: true,
          testTimeout: 20000,
          hookTimeout: 20000,
        },
      },
    ],
  },
});
