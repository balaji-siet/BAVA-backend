const mongoose = require('mongoose');

const forecastSchema = new mongoose.Schema({
  date: { type: String, required: true },
  meal_type: { type: String, required: true },
  predicted_count: { type: Number, required: true }
}, { timestamps: true });

forecastSchema.index({ date: 1, meal_type: 1 }, { unique: true });

const Forecast = mongoose.model('Forecast', forecastSchema);

const Reservation = require('../models/Reservation');

// Get future forecasts
const getForecasts = async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const storedForecasts = await Forecast.find().sort({ date: 1, meal_type: 1 });

    if (storedForecasts && storedForecasts.length > 0) {
      return res.status(200).json(storedForecasts);
    }

    // Dynamic fallback calculation based on reservations
    const reservationsToday = await Reservation.find({ reservation_date: today });
    let bCount = 0, lCount = 0, dCount = 0;
    reservationsToday.forEach(r => {
      if (r.breakfast) bCount++;
      if (r.lunch) lCount++;
      if (r.dinner) dCount++;
    });

    const fallback = [
      { date: today, meal_type: 'breakfast', predicted_count: Math.max(bCount, 45) },
      { date: today, meal_type: 'lunch', predicted_count: Math.max(lCount, 85) },
      { date: today, meal_type: 'dinner', predicted_count: Math.max(dCount, 60) }
    ];

    res.status(200).json(fallback);
  } catch (error) {
    console.error('Fetch forecasts error:', error);
    res.status(500).json({ error: 'Database error fetching demand forecasts' });
  }
};

// Save a new forecast prediction
const saveForecast = async (req, res) => {
  const { date, meal_type, predicted_count } = req.body;

  if (!date || !meal_type || predicted_count === undefined) {
    return res.status(400).json({ error: 'Date, meal_type, and predicted_count are required' });
  }

  try {
    const forecast = await Forecast.findOneAndUpdate(
      { date, meal_type },
      { predicted_count },
      { upsert: true, new: true }
    );

    res.status(200).json({ message: 'Forecast prediction saved successfully', forecast });
  } catch (error) {
    console.error('Save forecast error:', error);
    res.status(500).json({ error: 'Database error saving demand forecast' });
  }
};

module.exports = {
  getForecasts,
  saveForecast
};
