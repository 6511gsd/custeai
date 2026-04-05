// ============================================================
// CusteAi - Rotas de Autenticação
// ============================================================
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { query, withTransaction } = require('../config/database');
const { generateTokens, JWT_SECRET, REFRESH_EXPIRES } = require('../middleware/auth');
const jwt = require('jsonwebtoken');

// ── POST /api/auth/register ───────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { full_name, email, password, company_name, phone } = req.body;

    if (!full_name || !email || !password || !company_name)
      return res.status(400).json({ error: 'Preencha todos os campos obrigatórios' });

    if (password.length < 8)
      return res.status(400).json({ error: 'Senha deve ter ao menos 8 caracteres' });

    // Email já existe?
    const exists = await query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (exists.rows.length) return res.status(409).json({ error: 'E-mail já cadastrado' });

    const passwordHash = await bcrypt.hash(password, 12);

    const result = await withTransaction(async (client) => {
      // Cria usuário
      const userRes = await client.query(`
        INSERT INTO users (email, password_hash, full_name, phone, role)
        VALUES ($1, $2, $3, $4, 'owner')
        RETURNING id, email, full_name, role
      `, [email.toLowerCase(), passwordHash, full_name, phone || null]);
      const user = userRes.rows[0];

      // Cria empresa
      const companyRes = await client.query(`
        INSERT INTO companies (owner_id, name)
        VALUES ($1, $2)
        RETURNING id, name
      `, [user.id, company_name]);
      const company = companyRes.rows[0];

      // Cria configuração financeira padrão
      await client.query(`
        INSERT INTO financial_config (company_id) VALUES ($1)
      `, [company.id]);

      // Cria assinatura trial (14 dias)
      const planRes = await client.query(`SELECT id FROM plans WHERE slug = 'pro' LIMIT 1`);
      await client.query(`
        INSERT INTO subscriptions (company_id, plan_id, status, trial_ends_at)
        VALUES ($1, $2, 'trial', NOW() + INTERVAL '14 days')
      `, [company.id, planRes.rows[0]?.id]);

      return { user, company };
    });

    const tokens = generateTokens(result.user.id);

    // Salvar refresh token
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
    console.error(err);
    res.status(500).json({ error: 'Erro ao criar conta' });
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
      LEFT JOIN subscriptions s ON s.company_id = c.id
      LEFT JOIN plans p ON p.id = s.plan_id
      WHERE u.email = $1
      LIMIT 1
    `, [email.toLowerCase()]);

    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash)))
      return res.status(401).json({ error: 'E-mail ou senha incorretos' });

    if (!user.is_active) return res.status(403).json({ error: 'Conta desativada. Entre em contato com o suporte.' });

    const tokens = generateTokens(user.id);

    // Salvar sessão
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await query(`
      INSERT INTO sessions (user_id, refresh_token, ip_address, user_agent, expires_at)
      VALUES ($1, $2, $3, $4, $5)
    `, [user.id, tokens.refreshToken, req.ip, req.headers['user-agent'], expiresAt]);

    // Atualiza last_login
    await query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);

    const { password_hash, ...safeUser } = user;
    res.json({ user: safeUser, ...tokens });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao fazer login' });
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

    const tokens = generateTokens(payload.sub);

    // Rotaciona o refresh token
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await query(`
      UPDATE sessions SET refresh_token = $1, expires_at = $2 WHERE refresh_token = $3
    `, [tokens.refreshToken, expiresAt, refreshToken]);

    res.json(tokens);
  } catch (err) {
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
    const { rows } = await query('SELECT id FROM users WHERE email = $1', [email?.toLowerCase()]);
    // Responde igual seja ou não encontrado (segurança)
    if (rows.length) {
      const token = uuidv4();
      const expires = new Date(Date.now() + 60 * 60 * 1000); // 1h
      await query(`
        UPDATE users SET reset_password_token = $1, reset_password_expires = $2 WHERE id = $3
      `, [token, expires, rows[0].id]);
      // TODO: enviar e-mail com link de reset
      // await sendEmail({ to: email, template: 'reset-password', data: { token } })
      console.log(`[AUTH] Reset token para ${email}: ${token}`);
    }
    res.json({ message: 'Se o e-mail existir, você receberá as instruções em breve.' });
  } catch {
    res.status(500).json({ error: 'Erro ao processar solicitação' });
  }
});

// ── POST /api/auth/reset-password ────────────────────────
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password || password.length < 8)
      return res.status(400).json({ error: 'Token e senha (mín. 8 caracteres) são obrigatórios' });

    const { rows } = await query(`
      SELECT id FROM users WHERE reset_password_token = $1 AND reset_password_expires > NOW()
    `, [token]);

    if (!rows.length) return res.status(400).json({ error: 'Token inválido ou expirado' });

    const hash = await bcrypt.hash(password, 12);
    await query(`
      UPDATE users SET password_hash = $1, reset_password_token = NULL, reset_password_expires = NULL WHERE id = $2
    `, [hash, rows[0].id]);

    // Invalida todas as sessões
    await query('DELETE FROM sessions WHERE user_id = $1', [rows[0].id]);

    res.json({ message: 'Senha redefinida com sucesso!' });
  } catch {
    res.status(500).json({ error: 'Erro ao redefinir senha' });
  }
});

module.exports = router;
