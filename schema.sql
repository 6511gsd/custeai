-- ============================================================
-- CusteAi - Schema PostgreSQL
-- ============================================================

-- Extensão para UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- PLANOS DE ASSINATURA
-- ============================================================
CREATE TABLE plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(50) UNIQUE NOT NULL,
  price_cents INTEGER NOT NULL,          -- centavos (ex: 4990 = R$49,90)
  interval VARCHAR(20) DEFAULT 'month',  -- 'month' | 'year'
  features JSONB DEFAULT '[]',
  max_users INTEGER DEFAULT 1,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Planos padrão
INSERT INTO plans (name, slug, price_cents, features) VALUES
  ('Básico',    'basic',    2990, '["Até 50 ingredientes", "5 fichas técnicas", "1 usuário", "Suporte por e-mail"]'),
  ('Profissional', 'pro',   4990, '["Ingredientes ilimitados", "Fichas ilimitadas", "Importação de NF-e", "1 usuário", "Suporte prioritário"]'),
  ('Empresarial', 'business', 9990, '["Tudo do Pro", "Até 5 usuários", "Multi-empresa", "API de integração", "Suporte dedicado"]');

-- ============================================================
-- USUÁRIOS
-- ============================================================
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  phone VARCHAR(20),
  avatar_url TEXT,
  role VARCHAR(20) DEFAULT 'owner',      -- 'owner' | 'admin' | 'viewer'
  is_active BOOLEAN DEFAULT true,
  email_verified BOOLEAN DEFAULT false,
  email_verify_token VARCHAR(255),
  reset_password_token VARCHAR(255),
  reset_password_expires TIMESTAMPTZ,
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- EMPRESAS (cada usuário owner tem uma empresa)
-- ============================================================
CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  cnpj VARCHAR(20),
  phone VARCHAR(20),
  address TEXT,
  city VARCHAR(100),
  state VARCHAR(2),
  logo_url TEXT,
  segment VARCHAR(100),                  -- 'restaurante', 'lanchonete', 'pizzaria', etc
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- MEMBROS DA EMPRESA (gestão de acesso)
-- ============================================================
CREATE TABLE company_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(20) DEFAULT 'viewer',     -- 'admin' | 'editor' | 'viewer'
  invited_by UUID REFERENCES users(id),
  invite_token VARCHAR(255),
  invite_accepted BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, user_id)
);

-- ============================================================
-- ASSINATURAS
-- ============================================================
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES plans(id),
  status VARCHAR(30) DEFAULT 'trial',    -- 'trial' | 'active' | 'past_due' | 'canceled' | 'expired'
  
  -- Integração com gateway de pagamento (Stripe / Asaas / PagarMe)
  gateway VARCHAR(30),                   -- 'stripe' | 'asaas' | 'pagarme'
  gateway_customer_id VARCHAR(255),
  gateway_subscription_id VARCHAR(255),
  gateway_payment_method_id VARCHAR(255),
  
  trial_ends_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '14 days'),
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- HISTÓRICO DE PAGAMENTOS
-- ============================================================
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subscription_id UUID NOT NULL REFERENCES subscriptions(id),
  company_id UUID NOT NULL REFERENCES companies(id),
  amount_cents INTEGER NOT NULL,
  status VARCHAR(30),                    -- 'paid' | 'pending' | 'failed' | 'refunded'
  gateway_payment_id VARCHAR(255),
  payment_method VARCHAR(30),            -- 'credit_card' | 'boleto' | 'pix'
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- CONFIGURAÇÕES FINANCEIRAS DA EMPRESA (DNA)
-- ============================================================
CREATE TABLE financial_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE UNIQUE,
  monthly_revenue DECIMAL(12,2) DEFAULT 0,    -- faturamento mensal
  
  -- Taxas de cartão
  debit_card_rate DECIMAL(5,2) DEFAULT 2.0,
  credit_card_rate DECIMAL(5,2) DEFAULT 5.0,
  voucher_rate DECIMAL(5,2) DEFAULT 0,
  
  -- Impostos e taxas legais
  tax_rate DECIMAL(5,2) DEFAULT 0,
  royalty_rate DECIMAL(5,2) DEFAULT 0,
  marketing_rate DECIMAL(5,2) DEFAULT 0,
  
  -- DNA calculado (cache)
  dna_total DECIMAL(5,2) DEFAULT 0,
  cf_percentage DECIMAL(5,2) DEFAULT 0,
  
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- CUSTOS FIXOS
-- ============================================================
CREATE TABLE fixed_costs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  category VARCHAR(100),                 -- 'aluguel', 'pessoal', 'utilidades', 'marketing', 'outros'
  amount DECIMAL(12,2) NOT NULL,
  due_day INTEGER,                       -- dia do vencimento (1-31)
  is_recurring BOOLEAN DEFAULT true,
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- INGREDIENTES
-- ============================================================
CREATE TABLE ingredients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  category VARCHAR(100),
  unit VARCHAR(20) NOT NULL,             -- 'kg', 'g', 'L', 'ml', 'un', 'cx', 'pct'
  purchase_quantity DECIMAL(12,3),
  purchase_price DECIMAL(12,2),          -- valor total pago
  unit_cost DECIMAL(12,4),              -- custo por unidade (calculado)
  supplier VARCHAR(255),
  stock_quantity DECIMAL(12,3) DEFAULT 0,
  image_url TEXT,
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- FICHAS TÉCNICAS (PRODUTOS)
-- ============================================================
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  category VARCHAR(100),
  sale_price DECIMAL(12,2),
  yield_quantity INTEGER DEFAULT 1,      -- rendimento (nº de porções)
  cmv_total DECIMAL(12,4),              -- calculado
  image_url TEXT,
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ITENS DA FICHA TÉCNICA
-- ============================================================
CREATE TABLE product_ingredients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  ingredient_id UUID NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT,
  quantity DECIMAL(12,4) NOT NULL,
  unit VARCHAR(20),
  unit_cost_snapshot DECIMAL(12,4),      -- snapshot do custo no momento
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- SESSÕES (tokens JWT refresh)
-- ============================================================
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token VARCHAR(512) UNIQUE NOT NULL,
  ip_address INET,
  user_agent TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- LOGS DE AUDITORIA
-- ============================================================
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID REFERENCES companies(id),
  user_id UUID REFERENCES users(id),
  action VARCHAR(100) NOT NULL,          -- 'CREATE_INGREDIENT', 'DELETE_PRODUCT', etc
  entity VARCHAR(50),
  entity_id UUID,
  old_data JSONB,
  new_data JSONB,
  ip_address INET,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ÍNDICES
-- ============================================================
CREATE INDEX idx_ingredients_company ON ingredients(company_id) WHERE is_active = true;
CREATE INDEX idx_products_company ON products(company_id) WHERE is_active = true;
CREATE INDEX idx_fixed_costs_company ON fixed_costs(company_id) WHERE is_active = true;
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_token ON sessions(refresh_token);
CREATE INDEX idx_subscriptions_company ON subscriptions(company_id);
CREATE INDEX idx_audit_company ON audit_logs(company_id);
CREATE INDEX idx_company_members ON company_members(company_id, user_id);

-- ============================================================
-- TRIGGERS - updated_at automático
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_companies_updated_at BEFORE UPDATE ON companies FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_ingredients_updated_at BEFORE UPDATE ON ingredients FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_products_updated_at BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_fixed_costs_updated_at BEFORE UPDATE ON fixed_costs FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_financial_config_updated_at BEFORE UPDATE ON financial_config FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_subscriptions_updated_at BEFORE UPDATE ON subscriptions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
