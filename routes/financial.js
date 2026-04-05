// ============================================================
// CusteAi - Configuração Financeira (DNA da empresa)
// DNA = Despesas Não-Alimentares = custos fixos como % do faturamento
// CF  = Custo de Food (CMV médio dos produtos)
// ============================================================
const router = require('express').Router();
const { query } = require('../config/database');
const { requireSubscription } = require('../middleware/auth');

// GET /api/financial/config
router.get('/config', requireSubscription, async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT * FROM financial_config WHERE company_id=$1',
      [req.companyId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Configuração não encontrada' });
    res.json(rows[0]);
  } catch { res.status(500).json({ error: 'Erro ao buscar configuração financeira' }); }
});

// PUT /api/financial/config
router.put('/config', requireSubscription, async (req, res) => {
  try {
    const {
      monthly_revenue,
      debit_card_rate, credit_card_rate, voucher_rate,
      tax_rate, royalty_rate, marketing_rate,
    } = req.body;

    // Calcula DNA total (soma de todas as taxas)
    const dnaTotal =
      parseFloat(debit_card_rate   || 0) +
      parseFloat(credit_card_rate  || 0) +
      parseFloat(voucher_rate      || 0) +
      parseFloat(tax_rate          || 0) +
      parseFloat(royalty_rate      || 0) +
      parseFloat(marketing_rate    || 0);

    // CF% = total dos custos fixos / faturamento mensal * 100
    const { rows: fc } = await query(`
      SELECT COALESCE(SUM(amount), 0) AS total FROM fixed_costs WHERE company_id=$1 AND is_active=true
    `, [req.companyId]);

    const cfPercentage = monthly_revenue > 0
      ? (parseFloat(fc[0].total) / parseFloat(monthly_revenue)) * 100
      : 0;

    const { rows } = await query(`
      UPDATE financial_config SET
        monthly_revenue=$2,
        debit_card_rate=$3, credit_card_rate=$4, voucher_rate=$5,
        tax_rate=$6, royalty_rate=$7, marketing_rate=$8,
        dna_total=$9, cf_percentage=$10
      WHERE company_id=$1
      RETURNING *
    `, [
      req.companyId,
      monthly_revenue,
      debit_card_rate, credit_card_rate, voucher_rate,
      tax_rate, royalty_rate, marketing_rate,
      dnaTotal.toFixed(2), cfPercentage.toFixed(2),
    ]);

    res.json(rows[0]);
  } catch { res.status(500).json({ error: 'Erro ao salvar configuração financeira' }); }
});

// GET /api/financial/dashboard
// Retorna resumo executivo: CMV médio, margem, ponto de equilíbrio
router.get('/dashboard', requireSubscription, async (req, res) => {
  try {
    const [cfgRes, fixedRes, productsRes] = await Promise.all([
      query('SELECT * FROM financial_config WHERE company_id=$1', [req.companyId]),
      query('SELECT COALESCE(SUM(amount),0) AS total FROM fixed_costs WHERE company_id=$1 AND is_active=true', [req.companyId]),
      query(`
        SELECT
          COUNT(*) AS total_products,
          AVG(CASE WHEN sale_price > 0 THEN (cmv_total / sale_price) * 100 END) AS avg_cmv_pct,
          AVG(CASE WHEN sale_price > 0 THEN sale_price END) AS avg_sale_price
        FROM products WHERE company_id=$1 AND is_active=true
      `, [req.companyId]),
    ]);

    const cfg         = cfgRes.rows[0] || {};
    const fixedTotal  = parseFloat(fixedRes.rows[0].total);
    const prod        = productsRes.rows[0];

    const avgCmvPct   = parseFloat(prod.avg_cmv_pct  || 0);
    const dnaTotal    = parseFloat(cfg.dna_total      || 0);
    const cfPct       = parseFloat(cfg.cf_percentage  || 0);

    // Markup ideal = 100 / (100 - CMV% - DNA% - CF%)
    const markupBase  = 100 - avgCmvPct - dnaTotal - cfPct;
    const markupIdeal = markupBase > 0 ? (100 / markupBase).toFixed(2) : null;

    // Ponto de equilíbrio = custos fixos / (1 - (CMV% + DNA%) / 100)
    const variablePct = (avgCmvPct + dnaTotal) / 100;
    const breakEven   = variablePct < 1 ? (fixedTotal / (1 - variablePct)).toFixed(2) : null;

    res.json({
      monthly_revenue:  cfg.monthly_revenue,
      fixed_costs_total: fixedTotal,
      avg_cmv_pct:      avgCmvPct.toFixed(2),
      dna_total:        dnaTotal.toFixed(2),
      cf_percentage:    cfPct.toFixed(2),
      markup_ideal:     markupIdeal,
      break_even:       breakEven,
      total_products:   parseInt(prod.total_products),
      avg_sale_price:   parseFloat(prod.avg_sale_price || 0).toFixed(2),
    });
  } catch (err) {
    console.error('[FINANCIAL] dashboard:', err.message);
    res.status(500).json({ error: 'Erro ao calcular dashboard' });
  }
});

// GET /api/financial/pricing/:productId
// Calcula preço ideal de venda para um produto específico
router.get('/pricing/:productId', requireSubscription, async (req, res) => {
  try {
    const [prodRes, cfgRes] = await Promise.all([
      query('SELECT * FROM products WHERE id=$1 AND company_id=$2 AND is_active=true', [req.params.productId, req.companyId]),
      query('SELECT * FROM financial_config WHERE company_id=$1', [req.companyId]),
    ]);

    if (!prodRes.rows.length) return res.status(404).json({ error: 'Produto não encontrado' });

    const product = prodRes.rows[0];
    const cfg     = cfgRes.rows[0] || {};

    const cmvTotal   = parseFloat(product.cmv_total  || 0);
    const yield_qty  = parseInt(product.yield_quantity || 1);
    const cmvPortion = cmvTotal / yield_qty;

    const dnaTotal = parseFloat(cfg.dna_total     || 0);
    const cfPct    = parseFloat(cfg.cf_percentage || 0);

    // Preço ideal considerando CMV de 30% (padrão restaurante)
    const targetCmvPct = 30;
    const totalDeductions = dnaTotal + cfPct;
    const availableForCmv = 100 - totalDeductions;
    const cmvPct = availableForCmv > 0 ? Math.min(targetCmvPct, availableForCmv * 0.5) : targetCmvPct;

    const suggestedPrice = cmvPct > 0 ? (cmvPortion / (cmvPct / 100)).toFixed(2) : null;
    const currentCmvPct  = product.sale_price > 0
      ? ((cmvPortion / product.sale_price) * 100).toFixed(2)
      : null;

    res.json({
      product_name:    product.name,
      cmv_total:       cmvTotal.toFixed(4),
      cmv_per_portion: cmvPortion.toFixed(4),
      yield_quantity:  yield_qty,
      current_price:   product.sale_price,
      current_cmv_pct: currentCmvPct,
      suggested_price: suggestedPrice,
      target_cmv_pct:  cmvPct.toFixed(1),
      dna_total:       dnaTotal.toFixed(2),
      cf_percentage:   cfPct.toFixed(2),
    });
  } catch { res.status(500).json({ error: 'Erro ao calcular precificação' }); }
});

module.exports = router;
