// ============================================================
// CusteAi - Rotas de Autenticação
// ============================================================
const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { query, withTransaction } = require('../config/database');
const { generateTokens, JWT_SECRET, REFRESH_EXPIRES } = require('../middleware/auth');
const { sendPasswordReset } = require('../config/email');
const jwt = require('jsonwebtoken');

// ── POST /api/auth/register ───────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { full_name, email, password, company_name, phone } = req.body;

    if (!full_name || !email || !password || !company_name)
      return res.status(400).json({ error: 'Preencha todos os campos obrigatórios' });

    if (password.length < 8 || !/[A-Z]/.test(password) || !/[0-9]/.test(password))
      return res.status(400).json({ error: 'Senha deve ter ao menos 8 caracteres, uma letra maiúscula e um número' });

    const exists = await query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (exists.rows.length) return res.status(409).json({ error: 'E-mail já cadastrado' });

    const passwordHash = await bcrypt.hash(password, 12);

    const result = await withTransaction(async (client) => {
      const userRes = await client.query(`
        INSERT INTO users (email, password_hash, full_name, phone, role)
        VALUES ($1, $2, $3, $4, 'owner')
        RETURNING id, email, full_name, role
      `, [email.toLowerCase(), passwordHash, full_name, phone || null]);
      const user = userRes.rows[0];

      const companyRes = await client.query(`
        INSERT INTO companies (owner_id, name)
        VALUES ($1, $2)
        RETURNING id, name
      `, [user.id, company_name]);
      const company = companyRes.rows[0];

      await client.query(`INSERT INTO financial_config (company_id) VALUES ($1)`, [company.id]);

      const planRes = await client.query(`SELECT id FROM plans WHERE slug = 'pro' LIMIT 1`);
      await client.query(`
        INSERT INTO subscriptions (company_id, plan_id, status, trial_ends_at)
        VALUES ($1, $2, 'trial', NOW() + INTERVAL '14 days')
      `, [company.id, planRes.rows[0]?.id]);

      return { user, company };
    });

    const tokens = generateTokens(result.user.id);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await query(`
      INSERT INTO sessions (user_id, refresh_token, ip_address, user_agent, expires_at)
      VALUES ($1, $2, $3, $4, $5)
    `, [result.user.id, tokens.refreshToken, req.ip, req.headers['user-agent'], expiresAt]);

    res.status(201).json({
      message: 'Conta criada com sucesso! Trial de 14 dias ativado.',
      user: result.user,
      company: result.company,
      ...tokens,
    });
  } catch (err) {
    console.error('[AUTH] register:', err.message);
    res.status(500).json({ error: 'Erro ao criar conta', _debug: err.message });
  }
});

// ── POST /api/auth/login ──────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'E-mail e senha obrigatórios' });

    const { rows } = await query(`
      SELECT u.id, u.email, u.full_name, u.password_hash, u.role, u.is_active,
             c.id AS company_id, c.name AS company_name,
             s.status AS sub_status, s.trial_ends_at, s.current_period_end,
             p.name AS plan_name, p.slug AS plan_slug
      FROM users u
      LEFT JOIN companies c ON c.owner_id = u.id
      LEFT JOIN subscriptions s ON s.company_id = c.id AND s.status != 'canceled'
      LEFT JOIN plans p ON p.id = s.plan_id
      WHERE u.email = $1
      ORDER BY s.created_at DESC
      LIMIT 1
    `, [email.toLowerCase()]);

    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash)))
      return res.status(401).json({ error: 'E-mail ou senha incorretos' });

    if (!user.is_active) return res.status(403).json({ error: 'Conta desativada. Entre em contato com o suporte.' });

    const tokens = generateTokens(user.id);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await query(`
      INSERT INTO sessions (user_id, refresh_token, ip_address, user_agent, expires_at)
      VALUES ($1, $2, $3, $4, $5)
    `, [user.id, tokens.refreshToken, req.ip, req.headers['user-agent'], expiresAt]);

    await query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);

    const { password_hash, ...safeUser } = user;
    res.json({ user: safeUser, ...tokens });
  } catch (err) {
    console.error('[AUTH] login:', err.message);
    res.status(500).json({ error: 'Erro ao fazer login', _debug: err.message });
  }
});

// ── POST /api/auth/refresh ────────────────────────────────
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ error: 'Refresh token não fornecido' });

    const payload = jwt.verify(refreshToken, JWT_SECRET);
    if (payload.type !== 'refresh') return res.status(401).json({ error: 'Token inválido' });

    const { rows } = await query(`
      SELECT id FROM sessions WHERE refresh_token = $1 AND expires_at > NOW()
    `, [refreshToken]);

    if (!rows.length) return res.status(401).json({ error: 'Sessão expirada. Faça login novamente.' });

    const tokens    = generateTokens(payload.sub);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await query(`
      UPDATE sessions SET refresh_token = $1, expires_at = $2 WHERE refresh_token = $3
    `, [tokens.refreshToken, expiresAt, refreshToken]);

    res.json(tokens);
  } catch {
    res.status(401).json({ error: 'Token inválido ou expirado' });
  }
});

// ── POST /api/auth/logout ─────────────────────────────────
router.post('/logout', async (req, res) => {
  const { refreshToken } = req.body;
  if (refreshToken) await query('DELETE FROM sessions WHERE refresh_token = $1', [refreshToken]);
  res.json({ message: 'Logout realizado' });
});

// ── POST /api/auth/forgot-password ───────────────────────
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'E-mail obrigatório' });
    const { rows } = await query('SELECT id, full_name, reset_password_expires FROM users WHERE email = $1', [email.toLowerCase()]);
    if (rows.length) {
      // Rate limit por e-mail: máximo 1 reset a cada 5 minutos
      const lastExpires = rows[0].reset_password_expires;
      const fiveMinAgo  = new Date(Date.now() - 5 * 60 * 1000);
      if (lastExpires && new Date(lastExpires) > fiveMinAgo) {
        return res.json({ message: 'Se o e-mail existir, você receberá as instruções em breve.' });
      }
      const token   = require('crypto').randomBytes(32).toString('hex');
      const expires = new Date(Date.now() + 60 * 60 * 1000);
      await query(
        'UPDATE users SET reset_password_token=$1, reset_password_expires=$2 WHERE id=$3',
        [token, expires, rows[0].id]
      );
      await sendPasswordReset(email.toLowerCase(), token, rows[0].full_name);
    }
    // Sempre retorna sucesso (não revela se e-mail existe)
    res.json({ message: 'Se o e-mail existir, você receberá as instruções em breve.' });
  } catch (err) {
    console.error('[AUTH] forgot-password:', err.message);
    res.status(500).json({ error: 'Erro ao processar solicitação' });
  }
});

// ── POST /api/auth/reset-password ────────────────────────
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password || password.length < 8 || !/[A-Z]/.test(password) || !/[0-9]/.test(password))
      return res.status(400).json({ error: 'Token e senha válida (mín. 8 caracteres, uma maiúscula e um número) são obrigatórios' });

    const { rows } = await query(`
      SELECT id FROM users WHERE reset_password_token = $1 AND reset_password_expires > NOW()
    `, [token]);

    if (!rows.length) return res.status(400).json({ error: 'Token inválido ou expirado' });

    const hash = await bcrypt.hash(password, 12);
    await query(`
      UPDATE users SET password_hash = $1, reset_password_token = NULL, reset_password_expires = NULL WHERE id = $2
    `, [hash, rows[0].id]);

    await query('DELETE FROM sessions WHERE user_id = $1', [rows[0].id]);

    res.json({ message: 'Senha redefinida com sucesso!' });
  } catch {
    res.status(500).json({ error: 'Erro ao redefinir senha' });
  }
});

// ── GET /api/auth/me ──────────────────────────────────────
router.get('/me', require('../middleware/auth').requireAuth, async (req, res) => {
  const { password_hash, reset_password_token, email_verify_token, ...safeUser } = req.user;
  res.json(safeUser);
});

module.exports = router;
