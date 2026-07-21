const db = require('../config/db');

// POST /api/menu/create
const createMenu = async (req, res) => {
  const { meal_type, menu_description, serving_date } = req.body;

  if (!meal_type || !menu_description || !serving_date) {
    return res.status(400).json({ error: 'Meal Type, Menu Description, and Serving Date are required.' });
  }

  try {
    const [existing] = await db.query(
      'SELECT id FROM menus WHERE serving_date = ? AND meal_type = ? LIMIT 1',
      [serving_date, meal_type]
    );

    if (existing && existing.length > 0) {
      await db.query(
        'UPDATE menus SET menu_description = ? WHERE serving_date = ? AND meal_type = ?',
        [menu_description, serving_date, meal_type]
      );
      res.status(200).json({ message: 'Menu updated successfully' });
    } else {
      await db.query(
        'INSERT INTO menus (meal_type, menu_description, serving_date) VALUES (?, ?, ?)',
        [meal_type, menu_description, serving_date]
      );
      res.status(201).json({ message: 'Menu created successfully' });
    }
  } catch (error) {
    console.error('Create menu error:', error);
    res.status(500).json({ error: 'Database connection failed' });
  }
};

// PUT /api/menu/update
const updateMenu = async (req, res) => {
  const { id, menu_description } = req.body;

  if (!id || !menu_description) {
    return res.status(400).json({ error: 'Menu ID and Menu Description are required.' });
  }

  try {
    await db.query(
      'UPDATE menus SET menu_description = ? WHERE id = ?',
      [menu_description, id]
    );

    res.status(200).json({ message: 'Menu updated successfully' });
  } catch (error) {
    console.error('Update menu error:', error);
    res.status(500).json({ error: 'Database connection failed' });
  }
};

// DELETE /api/menu/delete
const deleteMenu = async (req, res) => {
  const { id } = req.body;

  if (!id) {
    return res.status(400).json({ error: 'Menu ID is required.' });
  }

  try {
    await db.query('DELETE FROM menus WHERE id = ?', [id]);
    res.status(200).json({ message: 'Menu deleted successfully' });
  } catch (error) {
    console.error('Delete menu error:', error);
    res.status(500).json({ error: 'Database connection failed' });
  }
};

// GET /api/menu
const getMenu = async (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];

  try {
    const [rows] = await db.query(
      'SELECT id, meal_type, menu_description, serving_date FROM menus WHERE serving_date = ?',
      [date]
    );

    res.status(200).json(rows);
  } catch (error) {
    console.error('Get menu error:', error);
    res.status(500).json({ error: 'Database connection failed' });
  }
};

module.exports = {
  createMenu,
  updateMenu,
  deleteMenu,
  getMenu
};
