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
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));

// ── Rate limiting ─────────────────────────────────────────
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { error: 'Muitas tentativas. Tente novamente em 15 minutos.' } }));
app.use('/api', rateLimit({ windowMs: 60 * 1000, max: 200 }));

// ── Body parsing ──────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Static files ──────────────────────────────────────────
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname)));          // serve index.html

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

// ── Health check ──────────────────────────────────────────
app.get('/health', (_, res) => res.json({ status: 'ok', version: '1.0.0', ts: new Date() }));

// ── SPA fallback (rotas do frontend) ──────────────────────
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Rota não encontrada' });
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ── Error handler ─────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.path}`, err);
  if (err.name === 'ValidationError') return res.status(400).json({ error: err.message });
  if (err.name === 'UnauthorizedError') return res.status(401).json({ error: 'Não autorizado' });
  res.status(500).json({ error: 'Erro interno. Tente novamente.' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`🚀 CusteAi API rodando na porta ${PORT}`));

module.exports = app;
