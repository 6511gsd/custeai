# CusteAi — Documentação de Setup

## Visão Geral

Sistema SaaS multi-tenant para gestão financeira de restaurantes.  
Cada cliente tem login próprio, empresa isolada, assinatura mensal e dados persistidos no banco.

---

## Estrutura do Projeto

```
custeai/
├── frontend/
│   └── index.html          ← SPA completa (HTML + CSS + JS)
├── backend/
│   ├── server.js            ← Entry point Express
│   ├── .env.example         ← Template de variáveis de ambiente
│   ├── package.json
│   ├── config/
│   │   ├── database.js      ← Pool PostgreSQL + helpers
│   │   └── schema.sql       ← Schema completo do banco
│   ├── middleware/
│   │   └── auth.js          ← JWT + verificação de assinatura
│   └── routes/
│       ├── auth.js          ← Login, registro, refresh, reset senha
│       ├── users.js         ← Perfil e senha do usuário
│       ├── companies.js     ← Empresa + membros da equipe
│       ├── ingredients.js   ← CRUD ingredientes + upload imagem
│       ├── products.js      ← CRUD fichas técnicas
│       ├── fixedCosts.js    ← CRUD custos fixos
│       ├── financial.js     ← Configuração financeira (taxas/DNA)
│       ├── subscriptions.js ← Planos, checkout, webhook
│       ├── import.js        ← Parser NF-e XML
│       └── admin.js         ← Painel admin (usuários, MRR)
└── docs/
    └── README.md            ← Este arquivo
```

---

## 1. Pré-requisitos

- Node.js 18+
- PostgreSQL 14+
- (opcional) Redis — para cache de sessões em escala

---

## 2. Banco de Dados

### Criar banco

```sql
CREATE DATABASE custeai;
```

### Rodar schema

```bash
psql -U postgres -d custeai -f backend/config/schema.sql
```

### Opções de hospedagem recomendadas

| Serviço | Gratuito | Indicado para |
|---------|----------|---------------|
| **Supabase** | Sim (500MB) | Desenvolvimento e produção inicial |
| **Railway** | $5/mês | Produção simples |
| **Render** | Sim (limitado) | Testes |
| **AWS RDS** | Pago | Produção robusta |
| **Neon** | Sim (branching) | Dev/staging |

---

## 3. Configuração do Backend

```bash
cd backend
cp .env.example .env
# Edite o .env com seus dados
npm install
npm run dev
```

### Variáveis obrigatórias no .env

```env
DATABASE_URL=postgresql://postgres:senha@localhost:5432/custeai
JWT_SECRET=uma-string-longa-e-aleatoria-aqui
FRONTEND_URL=http://localhost:3000
```

---

## 4. Configuração do Frontend

O frontend é um único arquivo HTML — sem build necessário.

### Desenvolvimento local

```bash
# Sirva com qualquer servidor estático
npx serve frontend/
# ou
python3 -m http.server 3000 --directory frontend/
```

### Conectar ao backend real

No `frontend/index.html`, linha ~530:

```javascript
// DEMO_MODE = true  → funciona sem backend (localStorage)
// DEMO_MODE = false → usa o backend real
const DEMO_MODE = false;
```

E ajuste a URL da API:

```javascript
const API = 'https://sua-api.custeai.com.br';
```

---

## 5. Gateway de Pagamento

### Opção A: Stripe (internacional + cartão)

```env
PAYMENT_GATEWAY=stripe
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

No `backend/routes/subscriptions.js`, descomente o bloco Stripe e implemente:

```javascript
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Checkout
const session = await stripe.checkout.sessions.create({
  mode: 'subscription',
  payment_method_types: ['card'],
  line_items: [{ price: stripePriceId, quantity: 1 }],
  success_url: `${process.env.APP_URL}/success`,
  cancel_url: `${process.env.APP_URL}/cancel`,
  customer_email: req.user.email,
});
return res.json({ checkout_url: session.url });
```

### Opção B: Asaas (Brasil — PIX, Boleto, Cartão)

```env
PAYMENT_GATEWAY=asaas
ASAAS_API_KEY=...
ASAAS_BASE_URL=https://api.asaas.com/v3
```

```javascript
// Criar cliente
const customer = await axios.post(`${process.env.ASAAS_BASE_URL}/customers`, {
  name: req.user.full_name,
  email: req.user.email,
  cpfCnpj: company.cnpj,
}, { headers: { 'access_token': process.env.ASAAS_API_KEY } });

// Criar cobrança recorrente
const charge = await axios.post(`${process.env.ASAAS_BASE_URL}/subscriptions`, {
  customer: customer.data.id,
  billingType: 'CREDIT_CARD', // ou 'BOLETO' ou 'PIX'
  value: 49.90,
  nextDueDate: new Date().toISOString().split('T')[0],
  cycle: 'MONTHLY',
});
```

### Webhook — ativar assinatura após pagamento

O endpoint `POST /api/subscriptions/webhook` já está estruturado.  
Configure a URL no painel do gateway: `https://sua-api.com/api/subscriptions/webhook`

---

## 6. Gestão de Acessos

### Níveis de acesso por empresa

| Role | Permissões |
|------|-----------|
| `owner` | Tudo + assinatura + gerenciar membros |
| `admin` | Tudo exceto assinatura |
| `editor` | Criar e editar dados |
| `viewer` | Somente leitura |

### Fluxo de convite

1. Owner vai em **Equipe → Convidar membro**
2. Backend gera token de convite e envia e-mail
3. Convidado clica no link → cria conta → é vinculado à empresa

### Middleware de proteção

```javascript
// Requer login
router.get('/rota', requireAuth, handler);

// Requer assinatura ativa (ou trial válido)
router.get('/rota', requireSubscription, handler);

// Requer papel específico
router.delete('/rota', requireAuth, requireRole('owner','admin'), handler);
```

---

## 7. Persistência de Dados

### Como funciona

- **DEMO_MODE = true**: dados salvos no `localStorage` do navegador — persistem entre reloads, mas são por dispositivo
- **DEMO_MODE = false**: todos os dados são salvos no PostgreSQL e acessíveis de qualquer dispositivo com login

### O que é salvo por usuário/empresa

| Dado | Tabela | Isolamento |
|------|--------|------------|
| Ingredientes | `ingredients` | Por `company_id` |
| Fichas técnicas | `products` + `product_ingredients` | Por `company_id` |
| Custos fixos | `fixed_costs` | Por `company_id` |
| Config financeira | `financial_config` | Por `company_id` |
| Imagens | `uploads/ingredients/` | Por filename UUID |

### Exclusão de dados

Ingredientes, fichas e custos fixos usam **soft delete** (`is_active = false`).  
Para exclusão permanente (LGPD), rode:

```sql
DELETE FROM companies WHERE id = 'uuid-da-empresa';
-- Cascata deleta tudo relacionado automaticamente
```

---

## 8. Deploy em Produção

### Backend (Railway / Render / Fly.io)

```bash
# railway.app
railway login
railway init
railway add --plugin postgresql
railway up
```

### Frontend (Vercel / Netlify)

```bash
# Netlify: arrastar a pasta frontend/ para netlify.com/drop
# Vercel: vercel --cwd frontend
```

### Nginx (servidor próprio)

```nginx
server {
    listen 443 ssl;
    server_name app.custeai.com.br;

    location / {
        root /var/www/custeai/frontend;
        try_files $uri $uri/ /index.html;
    }

    location /api {
        proxy_pass http://localhost:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

---

## 9. Checklist de Produção

- [ ] `JWT_SECRET` com string aleatória longa (min. 64 chars)
- [ ] `DB_SSL=true` com banco em nuvem
- [ ] `NODE_ENV=production`
- [ ] `DEMO_MODE=false` no frontend
- [ ] Gateway de pagamento configurado e testado
- [ ] Webhook URL registrada no painel do gateway
- [ ] Serviço de e-mail configurado (reset senha, convites)
- [ ] HTTPS habilitado
- [ ] Backups automáticos do banco ativados
- [ ] Rate limiting revisado para produção

---

## 10. Suporte

Configurações de banco, gateway ou deploy:  
Consulte a documentação de cada serviço ou entre em contato com o desenvolvedor.
