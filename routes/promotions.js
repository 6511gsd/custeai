// CusteAi - Promoções de Ingredientes
const router = require('express').Router();
const { query } = require('../config/database');
const { requireSubscription } = require('../middleware/auth');

// GET /api/promotions — lista promoções ativas da empresa
router.get('/', requireSubscription, async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT ip.*, i.name AS ingredient_name, i.unit, i.unit_cost AS current_unit_cost
      FROM ingredient_promotions ip
      JOIN ingredients i ON i.id = ip.ingredient_id
      WHERE ip.company_id = $1 AND ip.is_active = true
      ORDER BY ip.created_at DESC
    `, [req.companyId]);
    res.json(rows);
  } catch { res.status(500).json({ error: 'Erro ao buscar promoções' }); }
});

// POST /api/promotions — cadastra promoção
router.post('/', requireSubscription, async (req, res) => {
  try {
    const { ingredient_id, promo_price, promo_quantity, valid_until, notes } = req.body;
    if (!ingredient_id || !promo_price || !promo_quantity)
      return res.status(400).json({ error: 'ingredient_id, promo_price e promo_quantity são obrigatórios' });

    // Calcula custo unitário promocional
    const promo_unit_cost = parseFloat(promo_price) / parseFloat(promo_quantity);

    // Desativa promoção anterior do mesmo ingrediente
    await query(
      'UPDATE ingredient_promotions SET is_active=false WHERE ingredient_id=$1 AND company_id=$2',
      [ingredient_id, req.companyId]
    );

    const { rows } = await query(`
      INSERT INTO ingredient_promotions
        (ingredient_id, company_id, promo_price, promo_quantity, promo_unit_cost, valid_until, notes)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [ingredient_id, req.companyId, promo_price, promo_quantity, promo_unit_cost.toFixed(4), valid_until || null, notes || null]);

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[PROMOTIONS] post:', err.message);
    res.status(500).json({ error: 'Erro ao cadastrar promoção' });
  }
});

// DELETE /api/promotions/:id — remove promoção
router.delete('/:id', requireSubscription, async (req, res) => {
  try {
    await query(
      'UPDATE ingredient_promotions SET is_active=false WHERE id=$1 AND company_id=$2',
      [req.params.id, req.companyId]
    );
    res.json({ message: 'Promoção removida' });
  } catch { res.status(500).json({ error: 'Erro ao remover promoção' }); }
});

// GET /api/promotions/ingredient/:id — promoção ativa de um ingrediente específico
router.get('/ingredient/:id', requireSubscription, async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT ip.*, i.name AS ingredient_name, i.unit, i.unit_cost AS current_unit_cost
      FROM ingredient_promotions ip
      JOIN ingredients i ON i.id = ip.ingredient_id
      WHERE ip.ingredient_id=$1 AND ip.company_id=$2 AND ip.is_active=true
      ORDER BY ip.created_at DESC LIMIT 1
    `, [req.params.id, req.companyId]);
    res.json(rows[0] || null);
  } catch { res.status(500).json({ error: 'Erro ao buscar promoção' }); }
});

module.exports = router;
