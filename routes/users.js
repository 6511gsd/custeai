// ============================================================
// CusteAi - Perfil de Usuário
// ============================================================
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { query } = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const multer = require('multer');
const path   = require('path');
const fs     = require('fs');

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const SAFE_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../uploads/avatars');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = SAFE_EXT[file.mimetype] || '.jpg';
    cb(null, `avatar-${req.user.id}-${Date.now()}${ext}`);
  },
});
const fileFilter = (req, file, cb) => {
  if (ALLOWED_IMAGE_TYPES.includes(file.mimetype)) return cb(null, true);
  cb(Object.assign(new Error('Apenas imagens são permitidas (JPEG, PNG, WebP, GIF)'), { code: 'INVALID_FILE_TYPE' }), false);
};
const upload = multer({ storage, limits: { fileSize: 2 * 1024 * 1024 }, fileFilter });

// GET /api/users/me
router.get('/me', requireAuth, async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT id, email, full_name, phone, avatar_url, role, is_active, email_verified, last_login, created_at
      FROM users WHERE id = $1
    `, [req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'Usuário não encontrado' });
    res.json(rows[0]);
  } catch { res.status(500).json({ error: 'Erro ao buscar perfil' }); }
});

// PUT /api/users/me
router.put('/me', requireAuth, upload.single('avatar'), async (req, res) => {
  try {
    const { full_name, phone } = req.body;
    const avatarUrl = req.file ? `/uploads/avatars/${req.file.filename}` : undefined;

    const fields = ['full_name=$2', 'phone=$3'];
    const params = [req.user.id, full_name, phone];

    if (avatarUrl) { params.push(avatarUrl); fields.push(`avatar_url=$${params.length}`); }

    const { rows } = await query(
      `UPDATE users SET ${fields.join(', ')} WHERE id=$1
       RETURNING id, email, full_name, phone, avatar_url, role`,
      params
    );
    res.json(rows[0]);
  } catch { res.status(500).json({ error: 'Erro ao atualizar perfil' }); }
});

// PUT /api/users/me/password
router.put('/me/password', requireAuth, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password || new_password.length < 8 || !/[A-Z]/.test(new_password) || !/[0-9]/.test(new_password))
      return res.status(400).json({ error: 'Informe a senha atual e a nova senha (mín. 8 caracteres, uma maiúscula e um número)' });

    const { rows } = await query('SELECT password_hash FROM users WHERE id=$1', [req.user.id]);
    const valid = await bcrypt.compare(current_password, rows[0].password_hash);
    if (!valid) return res.status(401).json({ error: 'Senha atual incorreta' });

    const hash = await bcrypt.hash(new_password, 12);
    await query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, req.user.id]);

    // Invalida todas as sessões (força re-login em todos os dispositivos)
    await query('DELETE FROM sessions WHERE user_id=$1', [req.user.id]);

    res.json({ message: 'Senha alterada com sucesso. Faça login novamente.' });
  } catch { res.status(500).json({ error: 'Erro ao alterar senha' }); }
});

// GET /api/users/sessions
router.get('/sessions', requireAuth, async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT id, ip_address, user_agent, created_at, expires_at
      FROM sessions WHERE user_id=$1 AND expires_at > NOW() ORDER BY created_at DESC
    `, [req.user.id]);
    res.json(rows);
  } catch { res.status(500).json({ error: 'Erro ao buscar sessões' }); }
});

// DELETE /api/users/sessions/:id
router.delete('/sessions/:id', requireAuth, async (req, res) => {
  try {
    await query('DELETE FROM sessions WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    res.json({ message: 'Sessão encerrada' });
  } catch { res.status(500).json({ error: 'Erro ao encerrar sessão' }); }
});

module.exports = router;
