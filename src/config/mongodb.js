const mongoose = require("mongoose");

const connectMongoDB = async () => {
    if (!process.env.MONGODB_URI) {
        console.warn("⚠️ MONGODB_URI environment variable is not defined. Skipping MongoDB connection or waiting for env configuration.");
        return;
    }

    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log("✅ MongoDB Connected");
    } catch (err) {
        console.error("❌ MongoDB Connection Error:", err);
        process.exit(1);
    }
};

module.exports = connectMongoDB;
