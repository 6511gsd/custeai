// CusteAi - Migração v2: situação fiscal, marketplaces, promoções
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT) || 6543,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'postgres',
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
});

const migration = `
-- Situação fiscal e impostos
ALTER TABLE financial_config
  ADD COLUMN IF NOT EXISTS fiscal_type VARCHAR(20) DEFAULT 'mei',
  ADD COLUMN IF NOT EXISTS simples_aliquota DECIMAL(5,2) DEFAULT 0;

-- Configurações de marketplace (salvas por empresa)
ALTER TABLE financial_config
  ADD COLUMN IF NOT EXISTS ifood_commission DECIMAL(5,2) DEFAULT 27.0,
  ADD COLUMN IF NOT EXISTS rappi_commission DECIMAL(5,2) DEFAULT 30.0,
  ADD COLUMN IF NOT EXISTS novenovenove_commission DECIMAL(5,2) DEFAULT 12.0,
  ADD COLUMN IF NOT EXISTS marketplace_motoboy DECIMAL(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS marketplace_marketing DECIMAL(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS marketplace_packaging DECIMAL(10,2) DEFAULT 0;

-- Objetivo de CMV por canal
ALTER TABLE financial_config
  ADD COLUMN IF NOT EXISTS target_cmv_proprio DECIMAL(5,2) DEFAULT 30.0,
  ADD COLUMN IF NOT EXISTS target_cmv_marketplace DECIMAL(5,2) DEFAULT 25.0;

-- Tabela de promoções de ingredientes
CREATE TABLE IF NOT EXISTS ingredient_promotions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ingredient_id UUID NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  promo_price DECIMAL(12,2) NOT NULL,
  promo_quantity DECIMAL(12,3) NOT NULL,
  promo_unit_cost DECIMAL(12,4) NOT NULL,
  valid_until DATE,
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ingredient_promos
  ON ingredient_promotions(ingredient_id, company_id)
  WHERE is_active = true;
`;

async function run() {
  const client = await pool.connect();
  try {
    console.log('Aplicando migração v2...');
    await client.query(migration);
    console.log('✓ Migração v2 aplicada com sucesso!');
  } catch (err) {
    console.error('Erro na migração:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
