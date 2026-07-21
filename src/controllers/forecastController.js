const db = require('../config/db');

// Get future forecasts
const getForecasts = async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT date, meal_type, predicted_count, created_at FROM Forecasts ORDER BY date ASC, meal_type ASC"
    );

    const formattedRows = rows ? rows.map(row => {
      let dateVal = row.date;
      if (dateVal instanceof Date) {
        dateVal = dateVal.toISOString().split('T')[0];
      }
      return {
        date: dateVal,
        meal_type: row.meal_type,
        predicted_count: row.predicted_count,
        created_at: row.created_at
      };
    }) : [];

    res.status(200).json(formattedRows);
  } catch (error) {
    console.error('Fetch forecasts error:', error);
    res.status(500).json({ error: 'Database error fetching demand forecasts' });
  }
};

// Save a new forecast prediction (can be called by python service or cron)
const saveForecast = async (req, res) => {
  const { date, meal_type, predicted_count } = req.body;

  if (!date || !meal_type || predicted_count === undefined) {
    return res.status(400).json({ error: 'Date, meal_type, and predicted_count are required' });
  }

  try {
    // Check if prediction already exists for this date and meal_type
    const [existing] = await db.query(
      'SELECT id FROM Forecasts WHERE date = ? AND meal_type = ? LIMIT 1',
      [date, meal_type]
    );

    if (existing && existing.length > 0) {
      await db.query(
        'UPDATE Forecasts SET predicted_count = ?, created_at = CURRENT_TIMESTAMP WHERE date = ? AND meal_type = ?',
        [predicted_count, date, meal_type]
      );
    } else {
      await db.query(
        'INSERT INTO Forecasts (date, meal_type, predicted_count, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
        [date, meal_type, predicted_count]
      );
    }

    res.status(200).json({ message: 'Forecast prediction saved successfully' });
  } catch (error) {
    console.error('Save forecast error:', error);
    res.status(500).json({ error: 'Database error saving demand forecast' });
  }
};

module.exports = {
  getForecasts,
  saveForecast
};
