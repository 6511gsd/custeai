// CusteAi - Categorias dinâmicas por empresa
const router = require('express').Router();
const { query } = require('../config/database');
const { requireSubscription } = require('../middleware/auth');

const DEFAULT_ING = [
  { name: 'Proteínas',          emoji: '🥩', color: '#ef4444' },
  { name: 'Vegetais',           emoji: '🥦', color: '#22c55e' },
  { name: 'Laticínios',         emoji: '🧀', color: '#f59e0b' },
  { name: 'Grãos & Farinhas',   emoji: '🌾', color: '#d97706' },
  { name: 'Temperos & Molhos',  emoji: '🌶️', color: '#f97316' },
  { name: 'Óleos & Gorduras',   emoji: '🫙',  color: '#a3a3a3' },
  { name: 'Embalagens',         emoji: '📦', color: '#6366f1' },
  { name: 'Bebidas',            emoji: '🥤', color: '#22d3ee' },
  { name: 'Outros',             emoji: '📋', color: '#6b7280' },
];

const DEFAULT_CF = [
  { name: 'Aluguel',       emoji: '🏠', color: '#f97316' },
  { name: 'Pessoal',       emoji: '👤', color: '#a855f7' },
  { name: 'Utilidades',    emoji: '💡', color: '#22d3ee' },
  { name: 'Marketing',     emoji: '📣', color: '#ec4899' },
  { name: 'Equipamentos',  emoji: '🔧', color: '#6366f1' },
  { name: 'Impostos',      emoji: '📋', color: '#f59e0b' },
  { name: 'Outros',        emoji: '📦', color: '#6b7280' },
];

async function ensureDefaults(companyId, type) {
  const { rows } = await query(
    'SELECT id FROM categories WHERE company_id=$1 AND type=$2 LIMIT 1',
    [companyId, type]
  );
  if (rows.length) return;
  const defaults = type === 'ingredient' ? DEFAULT_ING : DEFAULT_CF;
  for (const d of defaults) {
    await query(
      'INSERT INTO categories (company_id, type, name, emoji, color) VALUES ($1,$2,$3,$4,$5)',
      [companyId, type, d.name, d.emoji, d.color]
    );
  }
}

// GET /api/categories?type=ingredient|fixed_cost
router.get('/', requireSubscription, async (req, res) => {
  try {
    const { type } = req.query;
    if (!type) return res.status(400).json({ error: 'type obrigatório' });
    await ensureDefaults(req.companyId, type);
    const { rows } = await query(
      'SELECT * FROM categories WHERE company_id=$1 AND type=$2 ORDER BY name',
      [req.companyId, type]
    );
    res.json(rows);
  } catch (err) {
    console.error('[CAT] GET:', err.message);
    res.status(500).json({ error: 'Erro ao buscar categorias' });
  }
});

// POST /api/categories
router.post('/', requireSubscription, async (req, res) => {
  try {
    const { type, name, emoji, color } = req.body;
    if (!type || !name) return res.status(400).json({ error: 'type e name obrigatórios' });
    const { rows } = await query(
      'INSERT INTO categories (company_id, type, name, emoji, color) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [req.companyId, type, name.trim(), emoji || '📦', color || '#6b7280']
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[CAT] POST:', err.message);
    res.status(500).json({ error: 'Erro ao criar categoria' });
  }
});

// PUT /api/categories/:id
router.put('/:id', requireSubscription, async (req, res) => {
  try {
    const { name, emoji, color } = req.body;
    if (!name) return res.status(400).json({ error: 'name obrigatório' });
    const { rows } = await query(
      'UPDATE categories SET name=$3, emoji=$4, color=$5 WHERE id=$1 AND company_id=$2 RETURNING *',
      [req.params.id, req.companyId, name.trim(), emoji || '📦', color || '#6b7280']
    );
    if (!rows.length) return res.status(404).json({ error: 'Categoria não encontrada' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[CAT] PUT:', err.message);
    res.status(500).json({ error: 'Erro ao atualizar categoria' });
  }
});

// DELETE /api/categories/:id
router.delete('/:id', requireSubscription, async (req, res) => {
  try {
    await query('DELETE FROM categories WHERE id=$1 AND company_id=$2', [req.params.id, req.companyId]);
    res.json({ message: 'Categoria removida' });
  } catch (err) {
    console.error('[CAT] DELETE:', err.message);
    res.status(500).json({ error: 'Erro ao remover categoria' });
  }
});

module.exports = router;
