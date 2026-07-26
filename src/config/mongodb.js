const mongoose = require("mongoose");

let lastMongoError = null;

const getMongoError = () => lastMongoError;

function maskUri(uri) {
    try {
        // mask password in the URI for safe logging
        return uri.replace(/:([^@/:]+)@/, ':****@');
    } catch (e) {
        return '(unable to parse URI)';
    }
}

const connectMongoDB = async () => {
    const mongoUri = process.env.MONGODB_URI;

    // 1. Check existence
    if (!mongoUri) {
        lastMongoError = "MONGODB_URI environment variable not found.";
        console.error("❌ MONGODB_URI environment variable not found.");
        return;
    }

    // 2. Check prefix
    if (!mongoUri.startsWith("mongodb://") && !mongoUri.startsWith("mongodb+srv://")) {
        lastMongoError = "Invalid MONGODB_URI format. Must start with mongodb:// or mongodb+srv://";
        console.error("❌ Invalid MONGODB_URI format. Must start with mongodb:// or mongodb+srv://");
        return;
    }

    // 3. Parse and validate components
    try {
        const url = new URL(mongoUri);
        const hostname = url.hostname;
        const username = url.username;
        const dbName = url.pathname.replace('/', '') || '(none)';

        console.log("🔗 MongoDB Connection Attempt:");
        console.log("   URI:", maskUri(mongoUri));
        console.log("   Hostname:", hostname);
        console.log("   Username:", username || '(empty)');
        console.log("   Database:", dbName);

        if (!username) {
            lastMongoError = "MONGODB_URI missing username";
            console.error("❌ MONGODB_URI is missing a username");
            return;
        }
        if (!url.password) {
            lastMongoError = "MONGODB_URI missing password";
            console.error("❌ MONGODB_URI is missing a password");
            return;
        }
        if (!hostname || hostname === 'localhost') {
            console.warn("⚠️  Hostname is", hostname, "— may not resolve on Render");
        }
    } catch (parseErr) {
        console.warn("⚠️  Could not parse MONGODB_URI as URL:", parseErr.message);
    }

    // 4. Attempt connection with raw error logging
    const startTime = Date.now();
    try {
        mongoose.set("strictQuery", true);

        await mongoose.connect(mongoUri, {
            serverSelectionTimeoutMS: 10000,
            connectTimeoutMS: 15000
        });

        const duration = Date.now() - startTime;
        lastMongoError = null;
        console.log(`✅ MongoDB Connected (${duration}ms)`);
    } catch (err) {
        const duration = Date.now() - startTime;

        // Log the COMPLETE raw error — do NOT hide any details
        console.error("═══════════════════════════════════════════════");
        console.error("❌ MongoDB Connection Error");
        console.error("   Duration:", duration + "ms");
        console.error("   Name:", err.name);
        console.error("   Code:", err.code || "(none)");
        console.error("   CodeName:", err.codeName || "(none)");
        console.error("   Message:", err.message);
        if (err.reason) {
            console.error("   Reason:", JSON.stringify(err.reason, null, 2));
        }
        if (err.cause) {
            console.error("   Cause:", err.cause.message || err.cause);
        }
        console.error("   Stack:", err.stack);
        console.error("═══════════════════════════════════════════════");

        // Store the REAL error for health endpoints
        lastMongoError = `${err.name || 'Error'}: ${err.message}`;
    }
};

module.exports = {
    connectMongoDB,
    getMongoError
};
