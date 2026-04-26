// Cria tabela categories
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  host: process.env.DB_HOST, port: process.env.DB_PORT,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, ssl: { rejectUnauthorized: false },
});
async function run() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        type       VARCHAR(20) NOT NULL CHECK (type IN ('ingredient','fixed_cost')),
        name       VARCHAR(100) NOT NULL,
        emoji      VARCHAR(10)  DEFAULT '📦',
        color      VARCHAR(20)  DEFAULT '#6b7280',
        created_at TIMESTAMPTZ  DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_categories_company ON categories(company_id, type);
    `);
    console.log('✅ Tabela categories criada');
  } finally { client.release(); await pool.end(); }
}
run().catch(e => { console.error(e.message); process.exit(1); });
