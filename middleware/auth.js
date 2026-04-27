// ============================================================
// CusteAi - Middlewares de autenticação e autorização
// ============================================================
const jwt = require('jsonwebtoken');
const { query } = require('../config/database');

if (!process.env.JWT_SECRET) throw new Error('FATAL: JWT_SECRET não definido nas variáveis de ambiente');
const JWT_SECRET      = process.env.JWT_SECRET;
const JWT_EXPIRES     = process.env.JWT_EXPIRES   || '7d';
const REFRESH_EXPIRES = process.env.REFRESH_EXPIRES || '30d';

// ── Gerar tokens ──────────────────────────────────────────
function generateTokens(userId) {
  const accessToken  = jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
  const refreshToken = jwt.sign({ sub: userId, type: 'refresh' }, JWT_SECRET, { expiresIn: REFRESH_EXPIRES });
  return { accessToken, refreshToken };
}

// ── Verificar JWT ─────────────────────────────────────────
async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Token não fornecido' });

    const token   = header.split(' ')[1];
    const payload = jwt.verify(token, JWT_SECRET);

    // Busca usuário + empresa + assinatura
    const { rows } = await query(`
      SELECT u.id, u.email, u.full_name, u.role, u.is_active,
             c.id AS company_id, c.name AS company_name,
             s.status AS sub_status, s.trial_ends_at,
             cm.role AS member_role
      FROM users u
      LEFT JOIN companies c ON c.owner_id = u.id
      LEFT JOIN company_members cm ON cm.user_id = u.id AND cm.invite_accepted = true
      LEFT JOIN subscriptions s ON s.company_id = COALESCE(c.id, cm.company_id) AND s.status != 'canceled'
      WHERE u.id = $1 AND u.is_active = true
      LIMIT 1
    `, [payload.sub]);

    if (!rows.length) return res.status(401).json({ error: 'Usuário não encontrado ou inativo' });

    req.user      = rows[0];
    req.companyId = rows[0].company_id;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') return res.status(401).json({ error: 'Token expirado', code: 'TOKEN_EXPIRED' });
    return res.status(401).json({ error: 'Token inválido' });
  }
}

// ── Verificar assinatura ativa (desativado — sistema gratuito) ──
async function requireSubscription(req, res, next) {
  return requireAuth(req, res, next);
}

// ── Verificar papel (role) ────────────────────────────────
function requireRole(...roles) {
  return (req, res, next) => {
    const userRole = req.user?.role || req.user?.member_role;
    if (!roles.includes(userRole)) {
      return res.status(403).json({ error: 'Permissão insuficiente' });
    }
    next();
  };
}

// ── Apenas admin do sistema ───────────────────────────────
function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Acesso restrito' });
  next();
}

module.exports = { requireAuth, requireSubscription, requireRole, requireAdmin, generateTokens, JWT_SECRET, REFRESH_EXPIRES };
