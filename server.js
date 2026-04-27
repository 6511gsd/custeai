// ============================================================
// CusteAi - Server Principal
// ============================================================
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();

// ── Segurança ──────────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      connectSrc: ["'self'", "https:"],
      fontSrc: ["'self'", "data:", "https:"],
      frameSrc: ["'self'", "https://www.youtube.com"],
      objectSrc: ["'none'"],
    },
  },
}));

const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:4000',
  'https://custeai.com.br',
  'https://www.custeai.com.br',
  'https://app.custeai.com.br',
  ...(process.env.FRONTEND_URL ? process.env.FRONTEND_URL.split(',') : []),
];

app.use(cors({
  origin: (origin, callback) => {
    // permite same-origin (origin undefined) e origens autorizadas
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error('Origem não permitida pelo CORS'));
  },
  credentials: true,
}));

// ── Rate limiting ─────────────────────────────────────────
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { error: 'Muitas tentativas. Tente novamente em 15 minutos.' } }));
app.use('/api', rateLimit({ windowMs: 60 * 1000, max: 200 }));

// ── Body parsing ──────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Static files ──────────────────────────────────────────
app.use('/uploads', (req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('Cache-Control', 'public, max-age=31536000');
  next();
}, express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname), { index: false }));

// ── Rotas ─────────────────────────────────────────────────
app.use('/api/auth',          require('./routes/auth'));
app.use('/api/companies',     require('./routes/companies'));
app.use('/api/users',         require('./routes/users'));
app.use('/api/ingredients',   require('./routes/ingredients'));
app.use('/api/products',      require('./routes/products'));
app.use('/api/fixed-costs',   require('./routes/fixedCosts'));
app.use('/api/financial',     require('./routes/financial'));
app.use('/api/subscriptions', require('./routes/subscriptions'));
app.use('/api/import',        require('./routes/import'));
app.use('/api/admin',         require('./routes/admin'));
app.use('/api/promotions',    require('./routes/promotions'));
app.use('/api/categories',   require('./routes/categories'));

// ── Health check ──────────────────────────────────────────
app.get('/health', (_, res) => res.json({ status: 'ok', version: '1.0.0', ts: new Date() }));

// ── Rotas do frontend ─────────────────────────────────────
app.get('/', (_, res) => res.sendFile(path.join(__dirname, 'landing.html')));
app.get('/app', (_, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/app/*', (_, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Rota não encontrada' });
  res.sendFile(path.join(__dirname, 'landing.html'));
});

// ── Error handler ─────────────────────────────────────────
app.use((err, req, res, _next) => {
  if (err.code === 'LIMIT_FILE_SIZE')   return res.status(400).json({ error: 'Arquivo muito grande. Limite: 2MB' });
  if (err.code === 'INVALID_FILE_TYPE') return res.status(400).json({ error: err.message });
  if (err.code === 'LIMIT_UNEXPECTED_FILE') return res.status(400).json({ error: 'Campo de arquivo inesperado' });
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.path}`, err.message);
  if (err.name === 'ValidationError') return res.status(400).json({ error: err.message });
  if (err.name === 'UnauthorizedError') return res.status(401).json({ error: 'Não autorizado' });
  res.status(500).json({ error: 'Erro interno. Tente novamente.' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`🚀 CusteAI API rodando na porta ${PORT}`));

module.exports = app;
