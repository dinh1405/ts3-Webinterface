import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import { csrfGuard } from './lib/auth.js';
import { errorMiddleware, notFound } from './lib/errors.js';
import { ts3 } from './lib/ts3.js';
import authRoutes from './routes/auth.js';
import serverRoutes from './routes/server.js';
import clientRoutes from './routes/clients.js';
import banRoutes from './routes/bans.js';
import logRoutes from './routes/logs.js';
import settingsRoutes from './routes/settings.js';
import backupRoutes from './routes/backups.js';
import userRoutes from './routes/users.js';
import auditRoutes from './routes/audit.js';
import eventRoutes from './routes/events.js';
import groupRoutes from './routes/groups.js';
import permissionRoutes from './routes/permissions.js';
import systemRoutes from './routes/system.js';
import statsRoutes from './routes/stats.js';
import channelRoutes from './routes/channels.js';
import complaintRoutes from './routes/complaints.js';
import fileRoutes from './routes/files.js';
import inviteRoutes from './routes/invites.js';
import historyRoutes from './routes/history.js';
import setupRoutes from './routes/setup.js';
import { reconfigureHooks } from './config.js';
import { appVersion } from './version.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy ? 1 : false);
  reconfigureHooks.add((cfg, changed) => { if (changed.includes('trustProxy')) app.set('trust proxy', cfg.trustProxy ? 1 : false); });

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:', 'http:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: null,
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
  }));
  app.use(express.json({ limit: '30mb' }));
  app.use(cookieParser());

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, version: appVersion(), ts3Connected: ts3.connected, uptime: process.uptime(), time: new Date().toISOString() });
  });

  const api = express.Router();
  api.use(csrfGuard);
  api.use('/auth', authRoutes);
  api.use('/server', serverRoutes);
  api.use('/clients', clientRoutes);
  api.use('/bans', banRoutes);
  api.use('/logs', logRoutes);
  api.use('/settings', settingsRoutes);
  api.use('/backups', backupRoutes);
  api.use('/users', userRoutes);
  api.use('/audit', auditRoutes);
  api.use('/events', eventRoutes);
  api.use('/groups', groupRoutes);
  api.use('/permissions', permissionRoutes);
  api.use('/system', systemRoutes);
  api.use('/stats', statsRoutes);
  api.use('/channels', channelRoutes);
  api.use('/complaints', complaintRoutes);
  api.use('/files', fileRoutes);
  api.use('/invites', inviteRoutes);
  api.use('/history', historyRoutes);
  api.use('/setup', setupRoutes);
  api.use(notFound);
  app.use('/api', api);

  // Statisches Frontend (Vite-Build) mit SPA-Fallback
  const indexFile = path.join(config.webDist, 'index.html');
  if (fs.existsSync(indexFile)) {
    app.use(express.static(config.webDist, { index: false, maxAge: '1h', setHeaders: (res, p) => { if (p.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); } }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(indexFile);
    });
  } else {
    app.get('/', (req, res) => {
      res.status(503).type('text/plain').send('Frontend not built. Run "npm run build" first.');
    });
  }

  app.use(errorMiddleware);
  return app;
}
