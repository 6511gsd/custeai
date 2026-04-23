// ============================================================
// CusteAi - Executa schema.sql no banco de dados
// Tenta: pooler IPv4 → direto IPv6
// ============================================================
require('dotenv').config();
const { Pool } = require('pg');
const path = require('path');
const fs   = require('fs');

const PASSWORD = process.env.DB_PASSWORD || '12849103Gd$';
const PROJECT  = 'idwtvgzbzluvzhzttclj';
const SCHEMA   = path.join(__dirname, '../schema.sql');

const DB_HOST = process.env.DB_HOST || 'aws-1-sa-east-1.pooler.supabase.com';
const DB_USER = process.env.DB_USER || `postgres.${PROJECT}`;

const configs = [
  // 1) Pooler via .env (configuração principal)
  {
    label: `Pooler .env (${DB_HOST}:6543)`,
    host: DB_HOST,
    port: 6543,
    user: DB_USER,
    password: PASSWORD,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  },
  // 2) Pooler session mode 5432
  {
    label: `Pooler .env (${DB_HOST}:5432)`,
    host: DB_HOST,
    port: 5432,
    user: DB_USER,
    password: PASSWORD,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  },
  // 3) Direto (IPv6 - fallback)
  {
    label: 'Direto db.supabase.co (5432)',
    host: `db.${PROJECT}.supabase.co`,
    port: 5432,
    user: 'postgres',
    password: PASSWORD,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  },
];

async function tryConnect(cfg) {
  const pool = new Pool(cfg);
  try {
    const client = await pool.connect();
    return { pool, client };
  } catch (err) {
    await pool.end().catch(() => {});
    throw err;
  }
}

async function run() {
  const sql = fs.readFileSync(SCHEMA, 'utf-8');
  let connected = null;

  for (const cfg of configs) {
    process.stdout.write(`Tentando ${cfg.label}... `);
    try {
      connected = await tryConnect(cfg);
      console.log('OK');
      break;
    } catch (err) {
      console.log(`falhou (${err.message.split('\n')[0]})`);
    }
  }

  if (!connected) {
    console.error('\nNão foi possível conectar ao Supabase.');
    console.error('Execute o schema manualmente no SQL Editor: https://supabase.com/dashboard/project/' + PROJECT + '/sql');
    process.exit(1);
  }

  const { pool, client } = connected;
  try {
    console.log('\nAplicando schema.sql...');
    await client.query(sql);
    console.log('✓ Schema aplicado com sucesso!');
  } catch (err) {
    if (err.message?.includes('already exists')) {
      console.log('✓ Tabelas já existem.');
    } else {
      console.error('Erro no schema:', err.message);
      process.exit(1);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

run();
