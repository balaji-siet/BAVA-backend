const Menu = require('../models/Menu');

const DEFAULT_MENU_ITEMS = {
  breakfast: { name: 'Breakfast', items: ['Idli', 'Sambar', 'Coconut Chutney', 'Tea/Coffee'], is_veg: true, category: 'South Indian', description: 'Freshly steamed idlis served with hot sambar.', calories: 350, status: 'Available' },
  lunch: { name: 'Lunch', items: ['Steamed Rice', 'Sambar', 'Kootu/Poriyal', 'Rasum', 'Fresh Curd'], is_veg: true, category: 'Standard Mess Thali', description: 'Balanced traditional meal with rice and curries.', calories: 650, status: 'Available' },
  dinner: { name: 'Dinner', items: ['Wheat Chapati', 'Mixed Veg Kurma', 'Jeera Rice', 'Dal Tadka'], is_veg: true, category: 'North Indian', description: 'Soft chapatis served with flavorful kurma.', calories: 500, status: 'Available' }
};

function getTodayStr() {
  return new Date().toISOString().split('T')[0];
}

function getYesterdayStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

// GET /api/menu/today
const getTodayMenu = async (req, res) => {
  try {
    const todayStr = getTodayStr();
    let menuDoc = await Menu.findOne({ date: todayStr });

    if (!menuDoc) {
      menuDoc = new Menu({
        date: todayStr,
        breakfast: DEFAULT_MENU_ITEMS.breakfast,
        lunch: DEFAULT_MENU_ITEMS.lunch,
        dinner: DEFAULT_MENU_ITEMS.dinner,
        is_published: true,
        updatedBy: 'System Default'
      });
      await menuDoc.save();
    }

    res.status(200).json({ success: true, menu: menuDoc });
  } catch (err) {
    console.error('Error fetching today menu:', err);
    res.status(500).json({ error: 'Failed to fetch today menu' });
  }
};

// GET /api/menu/:date
const getMenuByDate = async (req, res) => {
  try {
    const targetDate = req.params.date || getTodayStr();
    let menuDoc = await Menu.findOne({ date: targetDate });

    if (!menuDoc) {
      menuDoc = new Menu({
        date: targetDate,
        breakfast: DEFAULT_MENU_ITEMS.breakfast,
        lunch: DEFAULT_MENU_ITEMS.lunch,
        dinner: DEFAULT_MENU_ITEMS.dinner,
        is_published: true,
        updatedBy: 'System Default'
      });
      await menuDoc.save();
    }

    res.status(200).json({ success: true, menu: menuDoc });
  } catch (err) {
    console.error('Error fetching menu by date:', err);
    res.status(500).json({ error: 'Failed to fetch menu' });
  }
};

// POST /api/menu (Supervisor Add/Edit Menu)
const saveDailyMenu = async (req, res) => {
  try {
    const { date, breakfast, lunch, dinner, special_notice, is_published } = req.body;
    const targetDate = date || getTodayStr();

    let menuDoc = await Menu.findOne({ date: targetDate });
    if (!menuDoc) {
      menuDoc = new Menu({ date: targetDate });
    }

    if (breakfast) {
      if (breakfast.name !== undefined) menuDoc.breakfast.name = breakfast.name;
      if (breakfast.items) menuDoc.breakfast.items = Array.isArray(breakfast.items) ? breakfast.items : breakfast.items.split(',').map(s => s.trim());
      if (breakfast.description !== undefined) menuDoc.breakfast.description = breakfast.description;
      if (breakfast.is_veg !== undefined) menuDoc.breakfast.is_veg = Boolean(breakfast.is_veg);
      if (breakfast.category !== undefined) menuDoc.breakfast.category = breakfast.category;
      if (breakfast.prep_notes !== undefined) menuDoc.breakfast.prep_notes = breakfast.prep_notes;
      if (breakfast.image !== undefined) menuDoc.breakfast.image = breakfast.image;
      if (breakfast.calories !== undefined) menuDoc.breakfast.calories = Number(breakfast.calories) || 350;
      if (breakfast.quantity !== undefined) menuDoc.breakfast.quantity = Number(breakfast.quantity) || 500;
      if (breakfast.status !== undefined) menuDoc.breakfast.status = breakfast.status;
    }

    if (lunch) {
      if (lunch.name !== undefined) menuDoc.lunch.name = lunch.name;
      if (lunch.items) menuDoc.lunch.items = Array.isArray(lunch.items) ? lunch.items : lunch.items.split(',').map(s => s.trim());
      if (lunch.description !== undefined) menuDoc.lunch.description = lunch.description;
      if (lunch.is_veg !== undefined) menuDoc.lunch.is_veg = Boolean(lunch.is_veg);
      if (lunch.category !== undefined) menuDoc.lunch.category = lunch.category;
      if (lunch.prep_notes !== undefined) menuDoc.lunch.prep_notes = lunch.prep_notes;
      if (lunch.image !== undefined) menuDoc.lunch.image = lunch.image;
      if (lunch.calories !== undefined) menuDoc.lunch.calories = Number(lunch.calories) || 650;
      if (lunch.quantity !== undefined) menuDoc.lunch.quantity = Number(lunch.quantity) || 500;
      if (lunch.status !== undefined) menuDoc.lunch.status = lunch.status;
    }

    if (dinner) {
      if (dinner.name !== undefined) menuDoc.dinner.name = dinner.name;
      if (dinner.items) menuDoc.dinner.items = Array.isArray(dinner.items) ? dinner.items : dinner.items.split(',').map(s => s.trim());
      if (dinner.description !== undefined) menuDoc.dinner.description = dinner.description;
      if (dinner.is_veg !== undefined) menuDoc.dinner.is_veg = Boolean(dinner.is_veg);
      if (dinner.category !== undefined) menuDoc.dinner.category = dinner.category;
      if (dinner.prep_notes !== undefined) menuDoc.dinner.prep_notes = dinner.prep_notes;
      if (dinner.image !== undefined) menuDoc.dinner.image = dinner.image;
      if (dinner.calories !== undefined) menuDoc.dinner.calories = Number(dinner.calories) || 500;
      if (dinner.quantity !== undefined) menuDoc.dinner.quantity = Number(dinner.quantity) || 500;
      if (dinner.status !== undefined) menuDoc.dinner.status = dinner.status;
    }

    if (special_notice !== undefined) menuDoc.special_notice = special_notice;
    if (is_published !== undefined) menuDoc.is_published = Boolean(is_published);
    menuDoc.updatedBy = req.userRoll || 'Supervisor';

    await menuDoc.save();

    res.status(200).json({
      message: 'Daily menu saved successfully',
      menu: menuDoc
    });
  } catch (err) {
    console.error('Error saving daily menu:', err);
    res.status(500).json({ error: 'Failed to save daily menu' });
  }
};

// POST /api/menu/duplicate-yesterday
const duplicateYesterday = async (req, res) => {
  try {
    const todayStr = getTodayStr();
    const yesterdayStr = getYesterdayStr();

    let yesterdayMenu = await Menu.findOne({ date: yesterdayStr });
    if (!yesterdayMenu) {
      yesterdayMenu = DEFAULT_MENU_ITEMS;
    }

    let todayDoc = await Menu.findOne({ date: todayStr });
    if (!todayDoc) {
      todayDoc = new Menu({ date: todayStr });
    }

    todayDoc.breakfast = { ...yesterdayMenu.breakfast };
    todayDoc.lunch = { ...yesterdayMenu.lunch };
    todayDoc.dinner = { ...yesterdayMenu.dinner };
    todayDoc.is_published = true;
    todayDoc.updatedBy = 'Duplicated from Yesterday';

    await todayDoc.save();

    res.status(200).json({
      message: "Duplicated yesterday's menu for today successfully",
      menu: todayDoc
    });
  } catch (err) {
    console.error('Error duplicating yesterday menu:', err);
    res.status(500).json({ error: 'Failed to duplicate yesterday menu' });
  }
};

// GET /api/menu/search?q=query
const searchMenu = async (req, res) => {
  try {
    const query = (req.query.q || '').trim();
    if (!query) {
      return res.status(200).json([]);
    }

    const regex = new RegExp(query, 'i');
    const menus = await Menu.find({
      $or: [
        { 'breakfast.name': regex },
        { 'breakfast.items': regex },
        { 'lunch.name': regex },
        { 'lunch.items': regex },
        { 'dinner.name': regex },
        { 'dinner.items': regex }
      ]
    }).sort({ date: -1 }).limit(20);

    res.status(200).json(menus);
  } catch (err) {
    console.error('Error searching menu:', err);
    res.status(500).json({ error: 'Search failed' });
  }
};

// Legacy Compatibility Handlers
const createMenu = async (req, res) => {
  return saveDailyMenu(req, res);
};

const updateMenu = async (req, res) => {
  return saveDailyMenu(req, res);
};

const deleteMenu = async (req, res) => {
  try {
    const dateStr = req.body.date || req.body.day_of_week || getTodayStr();
    await Menu.findOneAndDelete({ date: dateStr });
    res.status(200).json({ message: 'Menu deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete menu' });
  }
};

const getMenu = async (req, res) => {
  return getTodayMenu(req, res);
};

module.exports = {
  getTodayMenu,
  getMenuByDate,
  saveDailyMenu,
  duplicateYesterday,
  searchMenu,
  createMenu,
  updateMenu,
  deleteMenu,
  getMenu
};
