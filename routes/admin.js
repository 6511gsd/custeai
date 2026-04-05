// ============================================================
// CusteAi - Painel Administrativo (acesso restrito)
// Requer: role = 'admin' no cadastro do usuário
// ============================================================
const router = require('express').Router();
const { query } = require('../config/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// Todas as rotas requerem autenticação + role admin
router.use(requireAuth, requireAdmin);

// GET /api/admin/stats
// Visão geral da plataforma
router.get('/stats', async (req, res) => {
  try {
    const [usersRes, companiesRes, subsRes, revenueRes] = await Promise.all([
      query(`SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days') AS last_30d FROM users`),
      query(`SELECT COUNT(*) AS total FROM companies`),
      query(`
        SELECT
          COUNT(*) FILTER (WHERE status='active')  AS active,
          COUNT(*) FILTER (WHERE status='trial')   AS trial,
          COUNT(*) FILTER (WHERE status='canceled') AS canceled,
          COUNT(*) FILTER (WHERE status='past_due') AS past_due
        FROM subscriptions
      `),
      query(`
        SELECT COALESCE(SUM(amount_cents), 0) AS total_cents
        FROM payments WHERE status='paid' AND paid_at > NOW() - INTERVAL '30 days'
      `),
    ]);

    res.json({
      users:    usersRes.rows[0],
      companies: companiesRes.rows[0],
      subscriptions: subsRes.rows[0],
      mrr_cents: parseInt(revenueRes.rows[0].total_cents),
    });
  } catch (err) {
    console.error('[ADMIN] stats:', err.message);
    res.status(500).json({ error: 'Erro ao buscar estatísticas' });
  }
});

// GET /api/admin/users
// Lista todos os usuários com paginação
router.get('/users', async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const offset = (page - 1) * limit;
    const search = req.query.search || '';

    const params = search
      ? [`%${search}%`, `%${search}%`, limit, offset]
      : [limit, offset];

    const where = search
      ? `WHERE u.email ILIKE $1 OR u.full_name ILIKE $2`
      : '';

    const limitParam  = search ? '$3' : '$1';
    const offsetParam = search ? '$4' : '$2';

    const { rows } = await query(`
      SELECT u.id, u.email, u.full_name, u.role, u.is_active, u.last_login, u.created_at,
             c.name AS company_name, s.status AS sub_status, p.slug AS plan_slug
      FROM users u
      LEFT JOIN companies c ON c.owner_id = u.id
      LEFT JOIN subscriptions s ON s.company_id = c.id AND s.status != 'canceled'
      LEFT JOIN plans p ON p.id = s.plan_id
      ${where}
      ORDER BY u.created_at DESC
      LIMIT ${limitParam} OFFSET ${offsetParam}
    `, params);

    const countRes = await query(
      `SELECT COUNT(*) AS total FROM users u ${where}`,
      search ? [`%${search}%`, `%${search}%`] : []
    );

    res.json({
      data:  rows,
      total: parseInt(countRes.rows[0].total),
      page,
      limit,
    });
  } catch (err) {
    console.error('[ADMIN] users:', err.message);
    res.status(500).json({ error: 'Erro ao listar usuários' });
  }
});

// PUT /api/admin/users/:id/status
// Ativar / desativar conta
router.put('/users/:id/status', async (req, res) => {
  try {
    const { is_active } = req.body;
    await query('UPDATE users SET is_active=$1 WHERE id=$2', [!!is_active, req.params.id]);
    res.json({ message: is_active ? 'Conta ativada' : 'Conta desativada' });
  } catch { res.status(500).json({ error: 'Erro ao atualizar status' }); }
});

// PUT /api/admin/subscriptions/:companyId
// Ajustar assinatura manualmente (ex: reativar após problema de pagamento)
router.put('/subscriptions/:companyId', async (req, res) => {
  try {
    const { status, plan_slug, extend_days } = req.body;

    if (plan_slug) {
      const { rows: plans } = await query('SELECT id FROM plans WHERE slug=$1', [plan_slug]);
      if (!plans.length) return res.status(404).json({ error: 'Plano não encontrado' });
      await query('UPDATE subscriptions SET plan_id=$1 WHERE company_id=$2', [plans[0].id, req.params.companyId]);
    }

    if (status) {
      await query('UPDATE subscriptions SET status=$1 WHERE company_id=$2', [status, req.params.companyId]);
    }

    if (extend_days) {
      await query(`
        UPDATE subscriptions
        SET current_period_end = COALESCE(current_period_end, NOW()) + ($1 || ' days')::INTERVAL
        WHERE company_id = $2
      `, [parseInt(extend_days), req.params.companyId]);
    }

    res.json({ message: 'Assinatura atualizada' });
  } catch (err) {
    console.error('[ADMIN] sub:', err.message);
    res.status(500).json({ error: 'Erro ao atualizar assinatura' });
  }
});

// GET /api/admin/audit
// Log de auditoria com filtros
router.get('/audit', async (req, res) => {
  try {
    const { company_id, user_id, action, limit = 50 } = req.query;
    const params  = [];
    const filters = [];

    if (company_id) { params.push(company_id); filters.push(`company_id=$${params.length}`); }
    if (user_id)    { params.push(user_id);    filters.push(`user_id=$${params.length}`); }
    if (action)     { params.push(action);     filters.push(`action=$${params.length}`); }

    params.push(Math.min(500, parseInt(limit)));
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    const { rows } = await query(`
      SELECT al.*, u.email AS user_email, c.name AS company_name
      FROM audit_logs al
      LEFT JOIN users u ON u.id = al.user_id
      LEFT JOIN companies c ON c.id = al.company_id
      ${where}
      ORDER BY al.created_at DESC
      LIMIT $${params.length}
    `, params);

    res.json(rows);
  } catch { res.status(500).json({ error: 'Erro ao buscar logs' }); }
});

module.exports = router;
