// ============================================================
// CusteAi - Ingredientes
// ============================================================
const router = require('express').Router();
const { query } = require('../config/database');
const { requireSubscription } = require('../middleware/auth');
const multer = require('multer');
const path   = require('path');
const fs     = require('fs');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../uploads/ingredients');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

// GET /api/ingredients
router.get('/', requireSubscription, async (req, res) => {
  try {
    const { search, category } = req.query;
    let sql    = `SELECT * FROM ingredients WHERE company_id = $1 AND is_active = true`;
    const params = [req.companyId];

    if (search) { params.push(`%${search}%`); sql += ` AND name ILIKE $${params.length}`; }
    if (category) { params.push(category); sql += ` AND category = $${params.length}`; }

    sql += ' ORDER BY name';
    const { rows } = await query(sql, params);
    res.json(rows);
  } catch { res.status(500).json({ error: 'Erro ao buscar ingredientes' }); }
});

// GET /api/ingredients/:id
router.get('/:id', requireSubscription, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT * FROM ingredients WHERE id = $1 AND company_id = $2 AND is_active = true`,
      [req.params.id, req.companyId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Ingrediente não encontrado' });
    res.json(rows[0]);
  } catch { res.status(500).json({ error: 'Erro ao buscar ingrediente' }); }
});

// POST /api/ingredients
router.post('/', requireSubscription, upload.single('image'), async (req, res) => {
  try {
    const { name, category, unit, purchase_quantity, purchase_price, supplier, stock_quantity, notes } = req.body;
    if (!name || !unit) return res.status(400).json({ error: 'Nome e unidade são obrigatórios' });

    const unitCost = purchase_quantity > 0 ? purchase_price / purchase_quantity : 0;
    const imageUrl = req.file ? `/uploads/ingredients/${req.file.filename}` : null;

    const { rows } = await query(`
      INSERT INTO ingredients (company_id, name, category, unit, purchase_quantity, purchase_price, unit_cost, supplier, stock_quantity, image_url, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING *
    `, [req.companyId, name, category, unit, purchase_quantity, purchase_price, unitCost, supplier, stock_quantity || 0, imageUrl, notes]);

    res.status(201).json(rows[0]);
  } catch { res.status(500).json({ error: 'Erro ao salvar ingrediente' }); }
});

// PUT /api/ingredients/:id
router.put('/:id', requireSubscription, upload.single('image'), async (req, res) => {
  try {
    const { name, category, unit, purchase_quantity, purchase_price, supplier, stock_quantity, notes } = req.body;
    const unitCost = purchase_quantity > 0 ? purchase_price / purchase_quantity : 0;
    const imageUrl = req.file ? `/uploads/ingredients/${req.file.filename}` : undefined;

    const setClause = imageUrl
      ? `name=$2, category=$3, unit=$4, purchase_quantity=$5, purchase_price=$6, unit_cost=$7, supplier=$8, stock_quantity=$9, notes=$10, image_url=$11`
      : `name=$2, category=$3, unit=$4, purchase_quantity=$5, purchase_price=$6, unit_cost=$7, supplier=$8, stock_quantity=$9, notes=$10`;
    const params = imageUrl
      ? [req.params.id, name, category, unit, purchase_quantity, purchase_price, unitCost, supplier, stock_quantity, notes, imageUrl, req.companyId]
      : [req.params.id, name, category, unit, purchase_quantity, purchase_price, unitCost, supplier, stock_quantity, notes, req.companyId];

    const { rows } = await query(
      `UPDATE ingredients SET ${setClause} WHERE id=$1 AND company_id=$${params.length} RETURNING *`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'Ingrediente não encontrado' });
    res.json(rows[0]);
  } catch { res.status(500).json({ error: 'Erro ao atualizar ingrediente' }); }
});

// DELETE /api/ingredients/:id
router.delete('/:id', requireSubscription, async (req, res) => {
  try {
    await query('UPDATE ingredients SET is_active = false WHERE id = $1 AND company_id = $2', [req.params.id, req.companyId]);
    res.json({ message: 'Ingrediente removido' });
  } catch { res.status(500).json({ error: 'Erro ao remover ingrediente' }); }
});

module.exports = router;
