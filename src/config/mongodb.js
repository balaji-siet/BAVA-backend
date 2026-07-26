const mongoose = require("mongoose");

let lastMongoError = null;

const getMongoError = () => lastMongoError;

const connectMongoDB = async () => {
    const mongoUri = process.env.MONGODB_URI;

    if (!mongoUri) {
        lastMongoError = "MONGODB_URI environment variable not configured";
        console.error("❌ Invalid MONGODB_URI: MONGODB_URI environment variable not configured");
        return;
    }

    if (!mongoUri.startsWith("mongodb://") && !mongoUri.startsWith("mongodb+srv://")) {
        lastMongoError = "Invalid MONGODB_URI format. Must start with mongodb:// or mongodb+srv://";
        console.error("❌ Invalid MONGODB_URI: Must start with mongodb:// or mongodb+srv://");
        return;
    }

    try {
        mongoose.set("strictQuery", true);
        
        await mongoose.connect(mongoUri, {
            serverSelectionTimeoutMS: 5000,
            connectTimeoutMS: 10000
        });

        lastMongoError = null;
        console.log("✅ MongoDB Connected");
    } catch (err) {
        const errMsg = err.message || String(err);
        
        if (errMsg.includes("Authentication failed") || errMsg.includes("auth failed")) {
            lastMongoError = "❌ MongoDB Authentication Failed (Invalid Username/Password)";
        } else if (errMsg.includes("querySrv") || errMsg.includes("ENOTFOUND") || errMsg.includes("ECONNREFUSED")) {
            lastMongoError = "❌ Atlas Network Access / DNS Resolution Failed (Cluster Unreachable / IP Not Whitelisted)";
        } else if (errMsg.includes("SSL") || errMsg.includes("TLS")) {
            lastMongoError = "❌ MongoDB SSL/TLS Handshake Error";
        } else {
            lastMongoError = `❌ MongoDB Connection Failed: ${errMsg}`;
        }

        console.error(lastMongoError);
    }
};

module.exports = {
    connectMongoDB,
    getMongoError
};
