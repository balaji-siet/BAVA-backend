const Menu = require('../models/Menu');

// POST /api/menu/create
const createMenu = async (req, res) => {
  const { meal_type, menu_description, serving_date, day_of_week, items } = req.body;
  const description = menu_description || items || '';

  if (!meal_type || !description) {
    return res.status(400).json({ error: 'Meal Type and Menu Description are required.' });
  }

  const dayVal = day_of_week || serving_date || new Date().toISOString().split('T')[0];

  try {
    const menu = await Menu.findOneAndUpdate(
      { day_of_week: dayVal, meal_type },
      { items: description },
      { upsert: true, new: true }
    );

    res.status(200).json({ message: 'Menu updated successfully', menu });
  } catch (error) {
    console.error('Create menu error:', error);
    res.status(500).json({ error: 'Database connection failed' });
  }
};

// PUT /api/menu/update
const updateMenu = async (req, res) => {
  const { id, menu_description, items } = req.body;
  const description = menu_description || items;

  if (!id || !description) {
    return res.status(400).json({ error: 'Menu ID and Description are required.' });
  }

  try {
    const menu = await Menu.findByIdAndUpdate(id, { items: description }, { new: true });

    if (!menu) {
      return res.status(404).json({ error: 'Menu not found' });
    }

    res.status(200).json({ message: 'Menu updated successfully', menu });
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
    await Menu.findByIdAndDelete(id);
    res.status(200).json({ message: 'Menu deleted successfully' });
  } catch (error) {
    console.error('Delete menu error:', error);
    res.status(500).json({ error: 'Database connection failed' });
  }
};

// GET /api/menu
const getMenu = async (req, res) => {
  const date = req.query.date || req.query.day_of_week || new Date().toISOString().split('T')[0];

  try {
    const menus = await Menu.find({
      $or: [
        { day_of_week: date },
        { day_of_week: 'Monday' },
        { day_of_week: 'Tuesday' },
        { day_of_week: 'Wednesday' },
        { day_of_week: 'Thursday' },
        { day_of_week: 'Friday' },
        { day_of_week: 'Saturday' },
        { day_of_week: 'Sunday' }
      ]
    });

    const formatted = menus.map(m => ({
      id: m._id,
      meal_type: m.meal_type,
      menu_description: m.items,
      serving_date: date
    }));

    res.status(200).json(formatted);
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
