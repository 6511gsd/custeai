// ============================================================
// CusteAi - Custos Fixos
// ============================================================
const routerFC = require('express').Router();
const { query } = require('../config/database');
const { requireSubscription } = require('../middleware/auth');

// GET
routerFC.get('/', requireSubscription, async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT *, SUM(amount) OVER () AS total_sum
      FROM fixed_costs WHERE company_id = $1 AND is_active = true ORDER BY category, name
    `, [req.companyId]);
    const total = rows.reduce((acc, r) => acc + parseFloat(r.amount), 0);
    res.json({ items: rows, total });
  } catch { res.status(500).json({ error: 'Erro ao buscar custos fixos' }); }
});

// POST
routerFC.post('/', requireSubscription, async (req, res) => {
  try {
    const { name, category, amount, due_day, is_recurring, notes } = req.body;
    if (!name || !amount) return res.status(400).json({ error: 'Nome e valor são obrigatórios' });
    const { rows } = await query(`
      INSERT INTO fixed_costs (company_id, name, category, amount, due_day, is_recurring, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *
    `, [req.companyId, name, category || 'outros', amount, due_day, is_recurring !== false, notes]);
    res.status(201).json(rows[0]);
  } catch { res.status(500).json({ error: 'Erro ao salvar custo fixo' }); }
});

// PUT
routerFC.put('/:id', requireSubscription, async (req, res) => {
  try {
    const { name, category, amount, due_day, is_recurring, notes } = req.body;
    const { rows } = await query(`
      UPDATE fixed_costs SET name=$2, category=$3, amount=$4, due_day=$5, is_recurring=$6, notes=$7
      WHERE id=$1 AND company_id=$8 RETURNING *
    `, [req.params.id, name, category, amount, due_day, is_recurring, notes, req.companyId]);
    if (!rows.length) return res.status(404).json({ error: 'Não encontrado' });
    res.json(rows[0]);
  } catch { res.status(500).json({ error: 'Erro ao atualizar' }); }
});

// DELETE
routerFC.delete('/:id', requireSubscription, async (req, res) => {
  try {
    await query('UPDATE fixed_costs SET is_active = false WHERE id=$1 AND company_id=$2', [req.params.id, req.companyId]);
    res.json({ message: 'Removido' });
  } catch { res.status(500).json({ error: 'Erro ao remover' }); }
});

module.exports = routerFC;
