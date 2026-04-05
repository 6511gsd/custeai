// ============================================================
// CusteAi - Assinaturas e Pagamentos
// ============================================================
const express = require('express');
const router  = express.Router();
const { query, withTransaction } = require('../config/database');
const { requireAuth } = require('../middleware/auth');

// GET /api/subscriptions/status
router.get('/status', requireAuth, async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT s.*, p.name AS plan_name, p.price_cents, p.features, p.slug AS plan_slug
      FROM subscriptions s
      JOIN plans p ON p.id = s.plan_id
      WHERE s.company_id = $1
      ORDER BY s.created_at DESC LIMIT 1
    `, [req.companyId]);

    const sub = rows[0];
    if (!sub) return res.json({ status: 'none' });

    const trialDaysLeft = sub.status === 'trial'
      ? Math.max(0, Math.ceil((new Date(sub.trial_ends_at) - Date.now()) / (1000 * 60 * 60 * 24)))
      : 0;

    res.json({ ...sub, trial_days_left: trialDaysLeft });
  } catch { res.status(500).json({ error: 'Erro ao buscar assinatura' }); }
});

// GET /api/subscriptions/plans
router.get('/plans', async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM plans WHERE is_active=true ORDER BY price_cents');
    res.json(rows);
  } catch { res.status(500).json({ error: 'Erro ao buscar planos' }); }
});

// GET /api/subscriptions/history
router.get('/history', requireAuth, async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT * FROM payments WHERE company_id=$1 ORDER BY created_at DESC LIMIT 24
    `, [req.companyId]);
    res.json(rows);
  } catch { res.status(500).json({ error: 'Erro ao buscar histórico' }); }
});

// ──────────────────────────────────────────────────────────
// INTEGRAÇÃO COM GATEWAY DE PAGAMENTO
// Configure no .env:
//   PAYMENT_GATEWAY=stripe | asaas | pagarme
// ──────────────────────────────────────────────────────────

// POST /api/subscriptions/checkout
router.post('/checkout', requireAuth, async (req, res) => {
  const { plan_slug } = req.body;
  const gateway = process.env.PAYMENT_GATEWAY || 'stripe';

  try {
    // Busca plano
    const { rows: plans } = await query('SELECT * FROM plans WHERE slug=$1 AND is_active=true', [plan_slug]);
    if (!plans.length) return res.status(404).json({ error: 'Plano não encontrado' });

    if (gateway === 'stripe') {
      // Descomente e configure para ativar:
      // const stripe  = require('stripe')(process.env.STRIPE_SECRET_KEY);
      // const session = await stripe.checkout.sessions.create({
      //   mode: 'subscription',
      //   line_items: [{ price: plans[0].stripe_price_id, quantity: 1 }],
      //   success_url: `${process.env.APP_URL}/dashboard?checkout=success`,
      //   cancel_url:  `${process.env.APP_URL}/planos`,
      // });
      // return res.json({ checkout_url: session.url });
      return res.json({
        message: 'Configure STRIPE_SECRET_KEY no .env para ativar pagamentos',
        gateway: 'stripe',
        docs: 'https://stripe.com/docs/api',
      });
    }

    if (gateway === 'asaas') {
      // const asaas    = require('./asaas-client');
      // const customer = await asaas.createCustomer({ name: req.user.full_name, email: req.user.email });
      // const charge   = await asaas.createCharge({ customer: customer.id, value: plans[0].price_cents / 100 });
      // return res.json({ payment_url: charge.bankSlipUrl || charge.invoiceUrl });
      return res.json({
        message: 'Configure ASAAS_API_KEY no .env para ativar pagamentos',
        gateway: 'asaas',
        docs: 'https://docs.asaas.com',
      });
    }

    res.status(400).json({ error: 'Gateway de pagamento não configurado' });
  } catch (err) {
    console.error('[SUB] checkout:', err.message);
    res.status(500).json({ error: 'Erro ao criar checkout' });
  }
});

// POST /api/subscriptions/webhook
// Webhook raw body necessário para validar assinatura do Stripe
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const gateway = process.env.PAYMENT_GATEWAY || 'stripe';

  try {
    if (gateway === 'stripe') {
      // const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
      // const event  = stripe.webhooks.constructEvent(
      //   req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET
      // );
      // switch (event.type) {
      //   case 'invoice.paid':           await activateSubscription(event.data.object); break;
      //   case 'invoice.payment_failed': await suspendSubscription(event.data.object);  break;
      //   case 'customer.subscription.deleted': await cancelSubscription(event.data.object); break;
      // }
    }

    if (gateway === 'asaas') {
      // const event = req.body;
      // if (event.event === 'PAYMENT_CONFIRMED') await activateSubscription(event.payment);
      // if (event.event === 'PAYMENT_OVERDUE')   await suspendSubscription(event.payment);
    }

    res.json({ received: true });
  } catch (err) {
    console.error('[SUB] webhook:', err.message);
    res.status(400).json({ error: 'Webhook inválido' });
  }
});

// ── Helpers internos ──────────────────────────────────────
async function activateSubscription(gatewayData) {
  await query(`
    UPDATE subscriptions SET status='active',
      current_period_start=NOW(),
      current_period_end=NOW() + INTERVAL '1 month',
      gateway_payment_method_id=$2
    WHERE gateway_subscription_id=$1
  `, [gatewayData.subscription || gatewayData.id, gatewayData.payment_method]);

  await query(`
    INSERT INTO payments (subscription_id, company_id, amount_cents, status, gateway_payment_id, paid_at)
    SELECT id, company_id, $2, 'paid', $3, NOW()
    FROM subscriptions WHERE gateway_subscription_id=$1
  `, [gatewayData.subscription || gatewayData.id, gatewayData.amount_total || gatewayData.value * 100, gatewayData.id]);
}

async function suspendSubscription(gatewayData) {
  await query(`
    UPDATE subscriptions SET status='past_due' WHERE gateway_subscription_id=$1
  `, [gatewayData.subscription || gatewayData.id]);
}

async function cancelSubscription(gatewayData) {
  await query(`
    UPDATE subscriptions SET status='canceled', canceled_at=NOW() WHERE gateway_subscription_id=$1
  `, [gatewayData.id]);
}

module.exports = router;
