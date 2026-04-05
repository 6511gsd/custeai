// ============================================================
// CusteAi - Importação de dados (CSV de ingredientes / NF-e)
// ============================================================
const router = require('express').Router();
const { query, withTransaction } = require('../config/database');
const { requireSubscription } = require('../middleware/auth');
const multer = require('multer');
const path   = require('path');
const fs     = require('fs');

// Upload temporário para processamento
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../uploads/tmp');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `import-${Date.now()}${path.extname(file.originalname)}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.csv', '.xml', '.txt'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) return cb(null, true);
    cb(new Error('Formato não suportado. Use CSV ou XML.'));
  },
});

// ── POST /api/import/ingredients/csv ─────────────────────
// Formato CSV esperado:
// nome,categoria,unidade,qtd_compra,preco_compra,fornecedor
router.post('/ingredients/csv', requireSubscription, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Arquivo não enviado' });

  try {
    const content = fs.readFileSync(req.file.path, 'utf-8');
    const lines   = content.split('\n').filter(l => l.trim());

    // Remove cabeçalho
    const dataLines = lines[0].toLowerCase().includes('nome') ? lines.slice(1) : lines;

    const results = { created: 0, skipped: 0, errors: [] };

    await withTransaction(async (client) => {
      for (const [i, line] of dataLines.entries()) {
        const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
        const [name, category, unit, purchase_quantity, purchase_price, supplier] = cols;

        if (!name || !unit) {
          results.errors.push({ line: i + 2, error: 'Nome e unidade são obrigatórios', data: line });
          results.skipped++;
          continue;
        }

        const qty   = parseFloat(purchase_quantity) || 0;
        const price = parseFloat(purchase_price)    || 0;
        const cost  = qty > 0 ? price / qty : 0;

        await client.query(`
          INSERT INTO ingredients (company_id, name, category, unit, purchase_quantity, purchase_price, unit_cost, supplier)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
          ON CONFLICT DO NOTHING
        `, [req.companyId, name, category || 'outros', unit, qty, price, cost, supplier || null]);

        results.created++;
      }
    });

    // Remove arquivo temporário
    fs.unlinkSync(req.file.path);

    res.json({ message: `Importação concluída`, ...results });
  } catch (err) {
    if (req.file?.path) fs.unlinkSync(req.file.path).catch(() => {});
    console.error('[IMPORT] csv:', err.message);
    res.status(500).json({ error: 'Erro ao processar arquivo CSV' });
  }
});

// ── POST /api/import/ingredients/nfe ─────────────────────
// Importa ingredientes a partir de XML de NF-e
router.post('/ingredients/nfe', requireSubscription, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Arquivo XML não enviado' });

  try {
    const content = fs.readFileSync(req.file.path, 'utf-8');

    // Parser simples de NF-e (produção: usar biblioteca xml2js ou fast-xml-parser)
    const items = parseNFe(content);

    if (!items.length) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Nenhum item encontrado no XML. Verifique o formato da NF-e.' });
    }

    const results = { created: 0, skipped: 0, errors: [] };

    await withTransaction(async (client) => {
      for (const item of items) {
        try {
          const cost = item.qty > 0 ? item.price / item.qty : 0;
          await client.query(`
            INSERT INTO ingredients (company_id, name, unit, purchase_quantity, purchase_price, unit_cost, supplier, notes)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
            ON CONFLICT DO NOTHING
          `, [req.companyId, item.name, item.unit, item.qty, item.price, cost, item.supplier, `NF-e: ${item.code}`]);
          results.created++;
        } catch {
          results.errors.push({ item: item.name, error: 'Falha ao inserir' });
          results.skipped++;
        }
      }
    });

    fs.unlinkSync(req.file.path);
    res.json({ message: 'NF-e importada', ...results });
  } catch (err) {
    if (req.file?.path) fs.unlinkSync(req.file.path);
    console.error('[IMPORT] nfe:', err.message);
    res.status(500).json({ error: 'Erro ao processar NF-e' });
  }
});

// ── GET /api/import/template/csv ─────────────────────────
// Baixar template CSV de exemplo
router.get('/template/csv', requireSubscription, (req, res) => {
  const csv = [
    'nome,categoria,unidade,qtd_compra,preco_compra,fornecedor',
    'Farinha de Trigo,farináceos,kg,5,18.50,Distribuidora ABC',
    'Leite Integral,laticínios,L,12,62.40,Fazenda Boa Vista',
    'Açúcar Refinado,farináceos,kg,2,7.90,Atacado Sul',
  ].join('\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="template_ingredientes.csv"');
  res.send('\uFEFF' + csv); // BOM para UTF-8 no Excel
});

// ── Helper: parse básico de NF-e XML ─────────────────────
function parseNFe(xml) {
  const items = [];
  const detRegex = /<det[^>]*>([\s\S]*?)<\/det>/g;
  let match;

  while ((match = detRegex.exec(xml)) !== null) {
    const block = match[1];
    const get   = (tag) => {
      const m = new RegExp(`<${tag}[^>]*>([^<]*)<\/${tag}>`).exec(block);
      return m ? m[1].trim() : '';
    };

    const name    = get('xProd');
    const code    = get('cProd');
    const unit    = get('uCom') || get('uTrib') || 'un';
    const qty     = parseFloat(get('qCom')  || get('qTrib')  || '1');
    const price   = parseFloat(get('vProd') || '0');
    const supplier = (() => {
      const emitMatch = /<emit>([\s\S]*?)<\/emit>/.exec(xml);
      if (!emitMatch) return '';
      const xNome = /<xNome>([^<]*)<\/xNome>/.exec(emitMatch[1]);
      return xNome ? xNome[1].trim() : '';
    })();

    if (name) items.push({ name, code, unit, qty, price, supplier });
  }

  return items;
}

module.exports = router;
