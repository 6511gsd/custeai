// ============================================================
// CusteAi - Configuração Financeira
// ============================================================
const router = require('express').Router();
const { query } = require('../config/database');
const { requireSubscription } = require('../middleware/auth');

// GET /api/financial/config
router.get('/config', requireSubscription, async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM financial_config WHERE company_id=$1', [req.companyId]);
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
      // Situação fiscal
      fiscal_type, simples_aliquota,
      // Marketplace
      ifood_commission, rappi_commission, novenovenove_commission,
      marketplace_motoboy, marketplace_marketing, marketplace_packaging,
      // Objetivo CMV por canal
      target_cmv_proprio, target_cmv_marketplace,
    } = req.body;

    const dnaTotal =
      parseFloat(debit_card_rate   || 0) +
      parseFloat(credit_card_rate  || 0) +
      parseFloat(voucher_rate      || 0) +
      parseFloat(tax_rate          || 0) +
      parseFloat(royalty_rate      || 0) +
      parseFloat(marketing_rate    || 0);

    const { rows: fc } = await query(
      'SELECT COALESCE(SUM(amount), 0) AS total FROM fixed_costs WHERE company_id=$1 AND is_active=true',
      [req.companyId]
    );

    const cfPercentage = monthly_revenue > 0
      ? (parseFloat(fc[0].total) / parseFloat(monthly_revenue)) * 100
      : 0;

    const { rows } = await query(`
      UPDATE financial_config SET
        monthly_revenue=$2,
        debit_card_rate=$3, credit_card_rate=$4, voucher_rate=$5,
        tax_rate=$6, royalty_rate=$7, marketing_rate=$8,
        dna_total=$9, cf_percentage=$10,
        fiscal_type=$11, simples_aliquota=$12,
        ifood_commission=$13, rappi_commission=$14, novenovenove_commission=$15,
        marketplace_motoboy=$16, marketplace_marketing=$17, marketplace_packaging=$18,
        target_cmv_proprio=$19, target_cmv_marketplace=$20
      WHERE company_id=$1
      RETURNING *
    `, [
      req.companyId,
      monthly_revenue || 0,
      debit_card_rate || 0, credit_card_rate || 0, voucher_rate || 0,
      tax_rate || 0, royalty_rate || 0, marketing_rate || 0,
      dnaTotal.toFixed(2), cfPercentage.toFixed(2),
      fiscal_type || 'mei', simples_aliquota || 0,
      ifood_commission ?? 27.0, rappi_commission ?? 30.0, novenovenove_commission ?? 12.0,
      marketplace_motoboy || 0, marketplace_marketing || 0, marketplace_packaging || 0,
      target_cmv_proprio ?? 30.0, target_cmv_marketplace ?? 25.0,
    ]);

    // Reprecificar todos os produtos com o novo target CMV
    if (parseFloat(target_cmv_proprio) > 0) {
      await query(`
        UPDATE products
        SET sale_price = ROUND(
          (cmv_total / NULLIF(yield_quantity, 0)::numeric) / ($2 / 100.0), 2
        )
        WHERE company_id = $1 AND is_active = true AND cmv_total > 0
      `, [req.companyId, parseFloat(target_cmv_proprio)]);
    }

    res.json(rows[0]);
  } catch (err) {
    console.error('[FINANCIAL] config PUT:', err.message);
    res.status(500).json({ error: 'Erro ao salvar configuração financeira' });
  }
});

// GET /api/financial/dashboard
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

    const cfg        = cfgRes.rows[0] || {};
    const fixedTotal = parseFloat(fixedRes.rows[0].total);
    const prod       = productsRes.rows[0];

    const avgCmvPct  = parseFloat(prod.avg_cmv_pct || 0);
    const dnaTotal   = parseFloat(cfg.dna_total    || 0);
    const cfPct      = parseFloat(cfg.cf_percentage || 0);

    const markupBase  = 100 - avgCmvPct - dnaTotal - cfPct;
    const markupIdeal = markupBase > 0 ? (100 / markupBase).toFixed(2) : null;

    const variablePct = (avgCmvPct + dnaTotal) / 100;
    const breakEven   = variablePct < 1 ? (fixedTotal / (1 - variablePct)).toFixed(2) : null;

    res.json({
      monthly_revenue:   cfg.monthly_revenue,
      fixed_costs_total: fixedTotal,
      avg_cmv_pct:       avgCmvPct.toFixed(2),
      dna_total:         dnaTotal.toFixed(2),
      cf_percentage:     cfPct.toFixed(2),
      markup_ideal:      markupIdeal,
      break_even:        breakEven,
      total_products:    parseInt(prod.total_products),
      avg_sale_price:    parseFloat(prod.avg_sale_price || 0).toFixed(2),
    });
  } catch (err) {
    console.error('[FINANCIAL] dashboard:', err.message);
    res.status(500).json({ error: 'Erro ao calcular dashboard' });
  }
});

// GET /api/financial/pricing/:productId
// Retorna preços sugeridos por canal (próprio + marketplaces)
router.get('/pricing/:productId', requireSubscription, async (req, res) => {
  try {
    const [prodRes, cfgRes] = await Promise.all([
      query('SELECT * FROM products WHERE id=$1 AND company_id=$2 AND is_active=true', [req.params.productId, req.companyId]),
      query('SELECT * FROM financial_config WHERE company_id=$1', [req.companyId]),
    ]);

    if (!prodRes.rows.length) return res.status(404).json({ error: 'Produto não encontrado' });

    const product = prodRes.rows[0];
    const cfg     = cfgRes.rows[0] || {};

    const cmvTotal    = parseFloat(product.cmv_total  || 0);
    const yieldQty    = parseInt(product.yield_quantity || 1);
    const cmvPortion  = cmvTotal / yieldQty;
    const dnaTotal    = parseFloat(cfg.dna_total      || 0);
    const cfPct       = parseFloat(cfg.cf_percentage  || 0);
    const packaging   = parseFloat(cfg.marketplace_packaging || 0);
    const motoboy     = parseFloat(cfg.marketplace_motoboy   || 0);
    const mktMarketing = parseFloat(cfg.marketplace_marketing || 0);

    const targetProprio     = parseFloat(cfg.target_cmv_proprio     || 30);
    const targetMarketplace = parseFloat(cfg.target_cmv_marketplace  || 25);

    // Preço canal próprio
    const totalCostsProprio = dnaTotal + cfPct;
    const suggestedProprio = targetProprio > 0
      ? ((cmvPortion) / (targetProprio / 100)).toFixed(2)
      : null;

    // Função: preço para marketplace com comissão
    // Fórmula: restaurante recebe preço × (1 - comissão%), então
    // CMV = meta% × preço × (1 - comissão%) → preço = CMV / (meta% × (1 - comissão%))
    function marketplacePrice(commission) {
      const extraCostPerItem = packaging + motoboy;
      const baseCmv = cmvPortion + extraCostPerItem;
      const denominator = (targetMarketplace / 100) * (1 - commission / 100);
      if (denominator <= 0) return null;
      return (baseCmv / denominator).toFixed(2);
    }

    const currentCmvPct = product.sale_price > 0
      ? ((cmvPortion / product.sale_price) * 100).toFixed(2)
      : null;

    res.json({
      product_name:     product.name,
      cmv_per_portion:  cmvPortion.toFixed(4),
      yield_quantity:   yieldQty,
      current_price:    product.sale_price,
      current_cmv_pct:  currentCmvPct,
      // Canais
      proprio: {
        suggested_price: suggestedProprio,
        target_cmv_pct:  targetProprio,
        total_costs_pct: totalCostsProprio.toFixed(2),
      },
      ifood: {
        commission:      cfg.ifood_commission || 27,
        suggested_price: marketplacePrice(parseFloat(cfg.ifood_commission || 27)),
        target_cmv_pct:  targetMarketplace,
      },
      rappi: {
        commission:      cfg.rappi_commission || 30,
        suggested_price: marketplacePrice(parseFloat(cfg.rappi_commission || 30)),
        target_cmv_pct:  targetMarketplace,
      },
      novenovenove: {
        commission:      cfg.novenovenove_commission || 12,
        suggested_price: marketplacePrice(parseFloat(cfg.novenovenove_commission || 12)),
        target_cmv_pct:  targetMarketplace,
      },
      // Custos extras de marketplace
      marketplace_motoboy:   motoboy,
      marketplace_marketing: mktMarketing,
      marketplace_packaging: packaging,
    });
  } catch (err) {
    console.error('[FINANCIAL] pricing:', err.message);
    res.status(500).json({ error: 'Erro ao calcular precificação' });
  }
});

module.exports = router;
