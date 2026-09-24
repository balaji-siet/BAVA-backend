const fs = require('fs');
const path = require('path');

const logPath = path.join(__dirname, '..', '..', 'logs', 'smartmess_full_logcat.txt');

if (!fs.existsSync(logPath)) {
  console.error("Logcat file not found:", logPath);
  process.exit(1);
}

const content = fs.readFileSync(logPath, 'utf-8');
const lines = content.split('\n');

const patterns = [
  { category: 'FATAL EXCEPTION', regex: /FATAL EXCEPTION/i },
  { category: 'AndroidRuntime', regex: /AndroidRuntime/i },
  { category: 'ANR', regex: /\bANR\b|am_anr/i },
  { category: 'Force Finishing', regex: /Force finishing/i },
  { category: 'Process Died', regex: /Process .* has died/i },
  { category: 'Crash', regex: /\bCRASH\b/i },
  { category: 'NullPointerException', regex: /NullPointerException/i },
  { category: 'SecurityException', regex: /SecurityException/i },
  { category: 'IllegalStateException', regex: /IllegalStateException/i },
  { category: 'OutOfMemoryError', regex: /OutOfMemoryError/i },
  { category: 'React Native Warnings/Errors', regex: /ReactNativeJS/i },
  { category: 'Unhandled Promise Rejection', regex: /UnhandledPromiseRejection/i },
  { category: 'Axios/Network Errors', regex: /AxiosError|Network request failed|ECONNREFUSED/i },
  { category: 'HTTP 4xx/5xx', regex: /HTTP\s+[45]\d\d/i },
  { category: 'App Package Tag', regex: /com\.shakthimess\.smartmessv9/i }
];

const matchesByCategory = {};
patterns.forEach(p => matchesByCategory[p.category] = []);

lines.forEach((line, lineNum) => {
  patterns.forEach(p => {
    if (p.regex.test(line)) {
      matchesByCategory[p.category].push({ lineNum: lineNum + 1, line: line.trim() });
    }
  });
});

console.log("============================================================");
console.log("FULL ANDROID LOGCAT AUDIT SUMMARY");
console.log("Total log lines analyzed:", lines.length);
console.log("============================================================");

const summaryTable = [];
patterns.forEach(p => {
  const matches = matchesByCategory[p.category];
  summaryTable.push({
    Category: p.category,
    Count: matches.length,
    Status: matches.length === 0 ? 'CLEAN' : 'MATCHES FOUND'
  });
});

console.table(summaryTable);

const auditReportPath = path.join(__dirname, '..', '..', 'logs', 'logcat_audit_report.json');
fs.writeFileSync(auditReportPath, JSON.stringify(matchesByCategory, null, 2));
console.log("\nFull breakdown saved to:", auditReportPath);
