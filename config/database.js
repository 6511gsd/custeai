// ============================================================
// CusteAi - Configuração do Banco de Dados (PostgreSQL / Supabase)
// Usa parâmetros individuais para evitar problemas de parsing de URL
// ============================================================
require('dotenv').config();
const { Pool } = require('pg');

const isProduction = process.env.NODE_ENV === 'production';

// Preferir parâmetros individuais (mais confiável com senhas especiais)
const poolConfig = process.env.DB_HOST
  ? {
      host:     process.env.DB_HOST,
      port:     parseInt(process.env.DB_PORT) || 5432,
      user:     process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME || 'postgres',
      ssl: { rejectUnauthorized: false },
    }
  : {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    };

const pool = new Pool({
  ...poolConfig,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// Log de erros do pool
pool.on('error', (err) => {
  console.error('[DB] Erro inesperado no cliente idle:', err.message);
});

// Confirmar conexão e rodar migrações incrementais na inicialização
pool.connect()
  .then(async client => {
    console.log('[DB] Conectado ao Supabase com sucesso');
    try {
      await client.query(`
        ALTER TABLE product_ingredients ADD COLUMN IF NOT EXISTS loss_factor NUMERIC(5,2) DEFAULT 0;
      `);
    } catch (e) {
      console.warn('[DB] Migração loss_factor:', e.message);
    }
    client.release();
  })
  .catch(err => {
    console.error('[DB] Falha ao conectar:', err.message);
  });

// ── Query simples ─────────────────────────────────────────
const query = (text, params) => pool.query(text, params);

// ── Transação com rollback automático ────────────────────
async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Health check ──────────────────────────────────────────
async function healthCheck() {
  const { rows } = await query('SELECT NOW() AS ts');
  return rows[0].ts;
}

module.exports = { query, withTransaction, healthCheck, pool };
