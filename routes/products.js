// ============================================================
// CusteAi - Fichas Técnicas (Produtos)
// ============================================================
const router = require('express').Router();
const { query, withTransaction } = require('../config/database');
const { requireSubscription } = require('../middleware/auth');
const multer = require('multer');
const path   = require('path');
const fs     = require('fs');

const ALLOWED_IMAGE_TYPES = ['image/jpeg','image/png','image/webp','image/gif'];
const SAFE_EXT = {'image/jpeg':'.jpg','image/png':'.png','image/webp':'.webp','image/gif':'.gif'};
const fileFilter = (req, file, cb) => {
  if (ALLOWED_IMAGE_TYPES.includes(file.mimetype)) return cb(null, true);
  cb(Object.assign(new Error('Apenas imagens são permitidas'), {code:'INVALID_FILE_TYPE'}), false);
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../uploads/products');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = SAFE_EXT[file.mimetype] || '.jpg';
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 }, fileFilter });

// GET /api/products
router.get('/', requireSubscription, async (req, res) => {
  try {
    const { search, category } = req.query;
    let sql = `SELECT * FROM products WHERE company_id=$1 AND is_active=true`;
    const params = [req.companyId];

    if (search)   { params.push(`%${search}%`); sql += ` AND name ILIKE $${params.length}`; }
    if (category) { params.push(category);       sql += ` AND category = $${params.length}`; }

    sql += ' ORDER BY name';
    const { rows } = await query(sql, params);
    res.json(rows);
  } catch { res.status(500).json({ error: 'Erro ao buscar produtos' }); }
});

// GET /api/products/:id  (com ingredientes)
router.get('/:id', requireSubscription, async (req, res) => {
  try {
    const { rows: products } = await query(
      `SELECT * FROM products WHERE id=$1 AND company_id=$2 AND is_active=true`,
      [req.params.id, req.companyId]
    );
    if (!products.length) return res.status(404).json({ error: 'Produto não encontrado' });

    const { rows: items } = await query(`
      SELECT pi.*, i.name AS ingredient_name, i.unit, i.unit_cost
      FROM product_ingredients pi
      JOIN ingredients i ON i.id = pi.ingredient_id
      WHERE pi.product_id = $1
    `, [req.params.id]);

    res.json({ ...products[0], ingredients: items });
  } catch { res.status(500).json({ error: 'Erro ao buscar produto' }); }
});

// POST /api/products
router.post('/', requireSubscription, upload.single('image'), async (req, res) => {
  try {
    const { name, category, sale_price, yield_quantity, notes, ingredients } = req.body;
    if (!name) return res.status(400).json({ error: 'Nome é obrigatório' });

    const imageUrl = req.file ? `/uploads/products/${req.file.filename}` : null;
    const items    = typeof ingredients === 'string' ? JSON.parse(ingredients) : (ingredients || []);

    const result = await withTransaction(async (client) => {
      let cmvTotal = 0;
      for (const item of items) {
        const { rows } = await client.query('SELECT unit_cost, unit FROM ingredients WHERE id=$1', [item.ingredient_id]);
        if (rows.length) {
          item.unit_cost_snapshot = rows[0].unit_cost;
          item.unit = item.unit || rows[0].unit;
          const lossMultiplier = 1 + (parseFloat(item.loss_factor) || 0) / 100;
          cmvTotal += parseFloat(rows[0].unit_cost) * parseFloat(item.quantity) * lossMultiplier;
        }
      }

      const { rows: products } = await client.query(`
        INSERT INTO products (company_id, name, category, sale_price, yield_quantity, cmv_total, image_url, notes)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        RETURNING *
      `, [req.companyId, name, category, sale_price || 0, yield_quantity || 1, cmvTotal, imageUrl, notes]);

      const product = products[0];

      for (const item of items) {
        await client.query(`
          INSERT INTO product_ingredients (product_id, ingredient_id, quantity, unit, unit_cost_snapshot, loss_factor)
          VALUES ($1,$2,$3,$4,$5,$6)
        `, [product.id, item.ingredient_id, item.quantity, item.unit, item.unit_cost_snapshot, item.loss_factor || 0]);
      }

      return product;
    });

    res.status(201).json(result);
  } catch { res.status(500).json({ error: 'Erro ao salvar produto' }); }
});

// PUT /api/products/:id
router.put('/:id', requireSubscription, upload.single('image'), async (req, res) => {
  try {
    const { name, category, sale_price, yield_quantity, notes, ingredients } = req.body;
    const imageUrl = req.file ? `/uploads/products/${req.file.filename}` : undefined;
    const rawItems = typeof ingredients === 'string' ? JSON.parse(ingredients) : (ingredients || null);
    const items    = rawItems !== null && rawItems !== undefined ? rawItems : null;

    const result = await withTransaction(async (client) => {
      let cmvTotal = null;

      if (items !== null) {
        cmvTotal = 0;
        for (const item of items) {
          const { rows } = await client.query('SELECT unit_cost, unit FROM ingredients WHERE id=$1', [item.ingredient_id]);
          if (rows.length) {
            item.unit_cost_snapshot = rows[0].unit_cost;
            item.unit = item.unit || rows[0].unit;
            const lossMultiplier = 1 + (parseFloat(item.loss_factor) || 0) / 100;
            cmvTotal += parseFloat(rows[0].unit_cost) * parseFloat(item.quantity) * lossMultiplier;
          }
        }
      }

      const fields = ['name=$2', 'category=$3', 'sale_price=$4', 'yield_quantity=$5', 'notes=$6'];
      const params = [req.params.id, name, category, sale_price, yield_quantity, notes];

      if (cmvTotal !== null) { params.push(cmvTotal); fields.push(`cmv_total=$${params.length}`); }
      if (imageUrl)          { params.push(imageUrl); fields.push(`image_url=$${params.length}`); }
      params.push(req.companyId);

      const { rows: products } = await client.query(
        `UPDATE products SET ${fields.join(', ')} WHERE id=$1 AND company_id=$${params.length} RETURNING *`,
        params
      );
      if (!products.length) throw new Error('not_found');

      if (items !== null) {
        await client.query('DELETE FROM product_ingredients WHERE product_id=$1', [req.params.id]);
        for (const item of items) {
          await client.query(`
            INSERT INTO product_ingredients (product_id, ingredient_id, quantity, unit, unit_cost_snapshot, loss_factor)
            VALUES ($1,$2,$3,$4,$5,$6)
          `, [req.params.id, item.ingredient_id, item.quantity, item.unit, item.unit_cost_snapshot, item.loss_factor || 0]);
        }
      }

      return products[0];
    });

    res.json(result);
  } catch (err) {
    if (err.message === 'not_found') return res.status(404).json({ error: 'Produto não encontrado' });
    res.status(500).json({ error: 'Erro ao atualizar produto' });
  }
});

// DELETE /api/products/:id
router.delete('/:id', requireSubscription, async (req, res) => {
  try {
    await query('UPDATE products SET is_active=false WHERE id=$1 AND company_id=$2', [req.params.id, req.companyId]);
    res.json({ message: 'Produto removido' });
  } catch { res.status(500).json({ error: 'Erro ao remover produto' }); }
});

module.exports = router;
