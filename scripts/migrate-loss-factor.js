// Adiciona coluna loss_factor em product_ingredients
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
      ALTER TABLE product_ingredients
        ADD COLUMN IF NOT EXISTS loss_factor NUMERIC(5,2) DEFAULT 0;
    `);
    console.log('✅ Coluna loss_factor adicionada em product_ingredients');
  } finally { client.release(); await pool.end(); }
}
run().catch(e => { console.error(e.message); process.exit(1); });
