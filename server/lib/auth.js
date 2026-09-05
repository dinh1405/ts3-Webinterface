import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { getUser } from './users.js';
import { HttpError } from './errors.js';
import { can } from './capabilities.js';

export const COOKIE_NAME = 'ts3wi_session';

export function issueSession(req, res, user) {
  const token = jwt.sign(
    { sub: user.id, tv: user.tokenVersion || 0 },
    config.jwtSecret,
    { expiresIn: `${config.sessionHours}h` },
  );
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: req.secure,
    maxAge: config.sessionHours * 3600 * 1000,
    path: '/',
  });
}

export function clearSession(req, res) {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: 'strict', secure: req.secure, path: '/' });
}

export function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return next(new HttpError(401, 'errors.unauthorized'));
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    return next(new HttpError(401, 'errors.sessionExpired'));
  }
  const user = getUser(payload.sub);
  if (!user || !user.active || (user.tokenVersion || 0) !== (payload.tv || 0)) {
    return next(new HttpError(401, 'errors.sessionExpired'));
  }
  req.user = user;
  next();
}

export const requireRole = (...roles) => (req, res, next) => {
  const check = () => {
    if (!roles.includes(req.user.role)) return next(new HttpError(403, 'errors.forbidden'));
    next();
  };
  if (req.user) return check();
  // Sitzung laden, falls requireAuth nicht bereits vorgeschaltet war
  requireAuth(req, res, (err) => (err ? next(err) : check()));
};

/** Verlangt ein bestimmtes Webinterface-Recht (siehe lib/capabilities.js). */
export const requireCap = (...caps) => (req, res, next) => {
  const check = () => {
    if (!caps.some((c) => can(req.user, c))) return next(new HttpError(403, 'errors.forbidden'));
    next();
  };
  if (req.user) return check();
  requireAuth(req, res, (err) => (err ? next(err) : check()));
};

// Rückwärtskompatible Aliasse
export const requireWrite = requireRole('admin', 'operator');
export const requireAdmin = requireRole('admin');

/** Einfacher CSRF-Schutz: schreibende Anfragen müssen den Header X-Requested-With tragen (zusätzlich zum SameSite=Strict-Cookie). */
export function csrfGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-requested-with') !== 'XMLHttpRequest') {
    return next(new HttpError(403, 'errors.csrf'));
  }
  next();
}
