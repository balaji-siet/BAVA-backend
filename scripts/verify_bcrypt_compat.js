const bcryptNative = require('bcrypt');

(async () => {
  console.log("============================================================");
  console.log("VERIFYING NATIVE BCRYPT COMPATIBILITY");
  console.log("============================================================");

  try {
    const password = "TestPassword123!";

    // 1. Hash with native bcrypt
    console.log("1. Testing native bcrypt.hash...");
    const saltNative = await bcryptNative.genSalt(10);
    const hashNative = await bcryptNative.hash(password, saltNative);
    console.log("   Generated native hash: [redacted]");

    // 2. Compare native hash with native bcrypt.compare
    console.log("2. Testing native bcrypt.compare with native hash...");
    const matchNative = await bcryptNative.compare(password, hashNative);
    console.log("   Native compare result:", matchNative);
    if (!matchNative) throw new Error("Native bcrypt compare failed on native hash!");

    // 3. Test NATIVE bcrypt.compare against pre-created LEGACY bcryptjs $2a$ hash
    console.log("3. Testing NATIVE bcrypt.compare against LEGACY $2a$ hash...");
    const legacyHash = "$2a$10$DxEAEBvMdMOGi9QfUzW5YORD8XlxmuGJQ/PGsulD3KNQSaaSoQj/2";
    const matchLegacy = await bcryptNative.compare(password, legacyHash);
    console.log("   Native compare against legacy hash result:", matchLegacy);
    if (!matchLegacy) throw new Error("Native bcrypt compare failed on legacy hash!");

    console.log("============================================================");
    console.log("✅ NATIVE BCRYPT IS 100% COMPATIBLE AND FUNCTIONAL!");
    console.log("============================================================");
  } catch (err) {
    console.error("❌ Bcrypt compatibility error:", err);
    process.exit(1);
  }
})();
