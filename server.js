/**
 * Secure minimal backend
 * - Helmet for secure headers + CSP
 * - CORS restricted to configured origin(s)
 * - Rate limiting
 * - Body size limits + simple sanitization
 * - Safe file writes to storage directory
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const Joi = require('joi');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();

// If running behind a reverse-proxy (nginx, load balancer) trust its headers
// so `req.secure` and `req.protocol` reflect the original client request.
app.set('trust proxy', true);

// Enforce HTTPS when enabled via environment (use in production)
if (process.env.FORCE_HTTPS === '1') {
  // Enable HSTS for one year when forcing HTTPS
  app.use(helmet.hsts({ maxAge: 31536000, includeSubDomains: true, preload: true }));
  app.use((req, res, next) => {
    // req.secure is true when TLS is used; behind proxy check x-forwarded-proto
    const proto = req.headers['x-forwarded-proto'] || req.protocol;
    if (req.secure || String(proto).includes('https')) return next();
    const host = req.headers.host;
    const target = `https://${host}${req.originalUrl}`;
    return res.redirect(301, target);
  });
}

// Basic hardening
app.disable('x-powered-by');
app.use(helmet());

// Content Security Policy: allow known CDNs used by the frontend
app.use(
  helmet.contentSecurityPolicy({
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://cdn.jsdelivr.net', 'https://cdnjs.cloudflare.com'],
      styleSrc: ["'self'", 'https://fonts.googleapis.com', 'https://cdnjs.cloudflare.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"]
    }
  })
);

// Limit requests to mitigate brute-force/DoS
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false });
app.use(limiter);

// CORS: allow only configured origin(s) or same origin
const FRONTEND_ORIGINS = (process.env.FRONTEND_ORIGINS || 'http://localhost:3000').split(',');
app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true); // allow non-browser tools
      if (FRONTEND_ORIGINS.indexOf(origin) !== -1) return callback(null, true);
      return callback(new Error('CORS policy: Origin not allowed'));
    }
  })
);

// Body parsing with limits
app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: false, limit: '64kb' }));

// Storage directory (safe join, created if missing)
const storageDir = path.join(__dirname, '..', 'storage');
if (!fs.existsSync(storageDir)) fs.mkdirSync(storageDir, { recursive: true, mode: 0o700 });

// Users file for simple auth (NOT for production use)
const usersFile = path.join(storageDir, 'users.json');
if (!fs.existsSync(usersFile)) fs.writeFileSync(usersFile, JSON.stringify([]), { mode: 0o600 });

function readUsers() {
  try { return JSON.parse(fs.readFileSync(usersFile, 'utf8') || '[]'); } catch (e) { return []; }
}

function writeUsers(users) {
  fs.writeFileSync(usersFile, JSON.stringify(users, null, 2), { mode: 0o600 });
}

const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret_in_production';

// Validation schemas
const userSchema = Joi.object({
  nom: Joi.string().trim().min(1).max(100).required(),
  prenom: Joi.string().trim().min(1).max(100).required(),
  phone: Joi.string().pattern(/^[0-9+\- ]{6,20}$/).required(),
  password: Joi.string().min(6).required()
});

const loginSchema = Joi.object({ phone: Joi.string().pattern(/^[0-9+\- ]{6,20}$/).required(), password: Joi.string().min(6).required() });

const cvSchema = Joi.object().unknown(true).max(50); // allow any keys but limit number of keys
const letterSchema = Joi.object().unknown(true).max(50);

// Auth helpers
async function createUser(payload) {
  const users = readUsers();
  if (users.find(u => u.phone === payload.phone)) throw new Error('User exists');
  const hash = await bcrypt.hash(payload.password, 10);
  const user = { id: Date.now().toString(36), nom: payload.nom, prenom: payload.prenom, phone: payload.phone, passwordHash: hash, createdAt: new Date().toISOString() };
  users.push(user); writeUsers(users); return user;
}

async function verifyUser(phone, password) {
  const users = readUsers();
  const user = users.find(u => u.phone === phone); if (!user) return null;
  const ok = await bcrypt.compare(password, user.passwordHash);
  return ok ? user : null;
}

function authenticateToken(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing token' });
  const token = auth.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload; return next();
  } catch (e) { return res.status(401).json({ error: 'Invalid token' }); }
}

// Serve static frontend with no directory listing
const front = path.join(__dirname, '..', 'Frontend');
app.use(express.static(front, { index: false, extensions: ['html'] }));

// Health
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Simple sanitizer: strip angle brackets from strings to avoid basic XSS payloads
function sanitize(obj) {
  if (typeof obj === 'string') return obj.replace(/[<>]/g, '');
  if (Array.isArray(obj)) return obj.map(sanitize);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const k of Object.keys(obj)) out[k] = sanitize(obj[k]);
    return out;
  }
  return obj;
}

// Simple JSON size guard
function isBodySizeOk(obj, maxBytes = 50 * 1024) {
  try {
    return Buffer.byteLength(JSON.stringify(obj), 'utf8') <= maxBytes;
  } catch (e) {
    return false;
  }
}

// Save JSON endpoint (validated & sanitized)
function safeWriteJson(prefix, req, res) {
  const raw = req.body;
  if (!raw || typeof raw !== 'object') return res.status(400).json({ error: 'Invalid payload' });
  if (!isBodySizeOk(raw)) return res.status(413).json({ error: 'Payload too large' });
  const data = sanitize(raw);
  const filename = `${prefix}_${Date.now()}.json`;
  const filepath = path.join(storageDir, filename);
  try {
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2), { flag: 'wx', mode: 0o600 });
    return res.json({ message: `${prefix} enregistré avec succès !` });
  } catch (err) {
    console.error('Save error', err);
    return res.status(500).json({ error: 'Impossible de sauvegarder' });
  }
}

// Auth routes
app.post('/auth/register', async (req, res) => {
  try {
    const v = await userSchema.validateAsync(req.body);
    const user = await createUser(v);
    return res.json({ message: 'Utilisateur créé', id: user.id });
  } catch (err) {
    if (err.isJoi) return res.status(400).json({ error: err.message });
    if (String(err.message).includes('User exists')) return res.status(409).json({ error: 'Utilisateur déjà existant' });
    console.error(err); return res.status(500).json({ error: 'Erreur interne' });
  }
});

app.post('/auth/login', async (req, res) => {
  try {
    const v = await loginSchema.validateAsync(req.body);
    const user = await verifyUser(v.phone, v.password);
    if (!user) return res.status(401).json({ error: 'Identifiants invalides' });
    const token = jwt.sign({ id: user.id, phone: user.phone, nom: user.nom, prenom: user.prenom }, JWT_SECRET, { expiresIn: '2h' });
    return res.json({ token, expiresIn: 7200 });
  } catch (err) {
    if (err.isJoi) return res.status(400).json({ error: err.message });
    console.error(err); return res.status(500).json({ error: 'Erreur interne' });
  }
});

// Protected save endpoints (require Bearer token)
app.post('/saveCV', authenticateToken, (req, res) => {
  const { error } = cvSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });
  return safeWriteJson('CV', req, res);
});

app.post('/saveLetter', authenticateToken, (req, res) => {
  const { error } = letterSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });
  return safeWriteJson('Lettre', req, res);
});

// Fallback to index.html for SPA routes
app.get('*', (req, res) => {
  res.sendFile(path.join(front, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Backend sécurisé démarre sur http://localhost:${PORT}`));
