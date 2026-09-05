import { Router } from 'express';
import { requireAuth } from '../lib/auth.js';
import { ts3 } from '../lib/ts3.js';

const router = Router();

/** Server-Sent Events: Verbindungsstatus + TS3-Ereignisse in Echtzeit. */
router.get('/', requireAuth, (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  send('hello', { status: ts3.summary(), recent: ts3.recentEvents.slice(0, 50) });
  const onEvent = (e) => send('ts3event', e);
  const onStatus = (s) => send('status', s);
  ts3.on('event', onEvent);
  ts3.on('status', onStatus);
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(heartbeat);
    ts3.off('event', onEvent);
    ts3.off('status', onStatus);
  });
});

export default router;
