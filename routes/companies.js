// ============================================================
// CusteAi - Empresas
// ============================================================
const router = require('express').Router();
const { query } = require('../config/database');
const { requireAuth, requireRole } = require('../middleware/auth');
const multer = require('multer');
const path   = require('path');
const fs     = require('fs');

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const SAFE_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../uploads/logos');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = SAFE_EXT[file.mimetype] || '.jpg';
    cb(null, `logo-${Date.now()}${ext}`);
  },
});
const fileFilter = (req, file, cb) => {
  if (ALLOWED_IMAGE_TYPES.includes(file.mimetype)) return cb(null, true);
  cb(Object.assign(new Error('Apenas imagens são permitidas (JPEG, PNG, WebP, GIF)'), { code: 'INVALID_FILE_TYPE' }), false);
};
const upload = multer({ storage, limits: { fileSize: 2 * 1024 * 1024 }, fileFilter });

// GET /api/companies/me
router.get('/me', requireAuth, async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT c.*, fc.monthly_revenue, fc.debit_card_rate, fc.credit_card_rate,
             fc.voucher_rate, fc.tax_rate, fc.royalty_rate, fc.marketing_rate,
             fc.dna_total, fc.cf_percentage
      FROM companies c
      LEFT JOIN financial_config fc ON fc.company_id = c.id
      WHERE c.id = $1
    `, [req.companyId]);
    if (!rows.length) return res.status(404).json({ error: 'Empresa não encontrada' });
    res.json(rows[0]);
  } catch { res.status(500).json({ error: 'Erro ao buscar empresa' }); }
});

// PUT /api/companies/me
router.put('/me', requireAuth, requireRole('owner', 'admin'), upload.single('logo'), async (req, res) => {
  try {
    const { name, cnpj, phone, address, city, state, segment } = req.body;
    const logoUrl = req.file ? `/uploads/logos/${req.file.filename}` : undefined;

    const fields = ['name=$2', 'cnpj=$3', 'phone=$4', 'address=$5', 'city=$6', 'state=$7', 'segment=$8'];
    const params = [req.companyId, name, cnpj, phone, address, city, state, segment];

    if (logoUrl) { params.push(logoUrl); fields.push(`logo_url=$${params.length}`); }

    const { rows } = await query(
      `UPDATE companies SET ${fields.join(', ')} WHERE id=$1 RETURNING *`,
      params
    );
    res.json(rows[0]);
  } catch { res.status(500).json({ error: 'Erro ao atualizar empresa' }); }
});

// GET /api/companies/members
router.get('/members', requireAuth, requireRole('owner', 'admin'), async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT cm.id, cm.role, cm.invite_accepted, cm.created_at,
             u.id AS user_id, u.email, u.full_name, u.avatar_url, u.last_login
      FROM company_members cm
      JOIN users u ON u.id = cm.user_id
      WHERE cm.company_id = $1
      ORDER BY cm.created_at
    `, [req.companyId]);
    res.json(rows);
  } catch { res.status(500).json({ error: 'Erro ao listar membros' }); }
});

// POST /api/companies/members/invite
router.post('/members/invite', requireAuth, requireRole('owner', 'admin'), async (req, res) => {
  try {
    const { email, role } = req.body;
    if (!email) return res.status(400).json({ error: 'E-mail obrigatório' });

    const { rows: users } = await query('SELECT id FROM users WHERE email=$1', [email.toLowerCase()]);
    if (!users.length) return res.status(404).json({ error: 'Usuário não encontrado. Peça que ele se cadastre primeiro.' });

    const userId = users[0].id;
    const { v4: uuidv4 } = require('uuid');
    const inviteToken = uuidv4();

    await query(`
      INSERT INTO company_members (company_id, user_id, role, invited_by, invite_token)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (company_id, user_id) DO UPDATE SET role=$3, invite_token=$5
    `, [req.companyId, userId, role || 'viewer', req.user.id, inviteToken]);

    console.log(`[COMPANY] Convite criado para ${email}`);
    res.json({ message: 'Convite enviado' });
  } catch { res.status(500).json({ error: 'Erro ao convidar membro' }); }
});

// DELETE /api/companies/members/:userId
router.delete('/members/:userId', requireAuth, requireRole('owner', 'admin'), async (req, res) => {
  try {
    await query('DELETE FROM company_members WHERE company_id=$1 AND user_id=$2', [req.companyId, req.params.userId]);
    res.json({ message: 'Membro removido' });
  } catch { res.status(500).json({ error: 'Erro ao remover membro' }); }
});

module.exports = router;
