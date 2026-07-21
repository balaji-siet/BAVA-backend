const db = require('../config/db');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

// Helper to get time
function getLocalDateStr(offsetDays = 0) {
  const date = new Date();
  if (offsetDays !== 0) {
    date.setDate(date.getDate() + offsetDays);
  }
  return date.toISOString().split('T')[0];
}

// Fetch report data helper
async function fetchReportData(startDate, endDate) {
  // Get all reservations and attendance records in date range
  const [reservations] = await db.query(
    `SELECT r.reservation_date, r.meal_type, r.reservation_status, s.name, s.roll_number, s.hostel_block, s.department
     FROM meal_reservations r
     JOIN students s ON r.student_id = s.id
     WHERE r.reservation_date BETWEEN ? AND ?`,
    [startDate, endDate]
  );

  const [attendance] = await db.query(
    `SELECT a.attendance_date, a.meal_type, a.attendance_status, s.name, s.roll_number, s.hostel_block, s.department
     FROM attendance a
     JOIN students s ON a.student_id = s.id
     WHERE a.attendance_date BETWEEN ? AND ?`,
    [startDate, endDate]
  );

  return {
    reservations: reservations || [],
    attendance: attendance || []
  };
}

// Generate Excel
async function generateExcelReport(title, data, res) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Report');

  // Headers
  worksheet.columns = [
    { header: 'Date', key: 'date', width: 15 },
    { header: 'Student Name', key: 'name', width: 25 },
    { header: 'Roll Number', key: 'roll', width: 15 },
    { header: 'Department', key: 'dept', width: 15 },
    { header: 'Hostel Block', key: 'block', width: 15 },
    { header: 'Meal Type', key: 'meal', width: 15 },
    { header: 'Reservation Status', key: 'res_status', width: 20 },
    { header: 'Attendance Status', key: 'att_status', width: 20 }
  ];

  // Merge lists to row data
  const map = {};
  data.reservations.forEach(r => {
    const key = `${r.reservation_date}_${r.roll_number}_${r.meal_type}`;
    map[key] = {
      date: r.reservation_date,
      name: r.name,
      roll: r.roll_number,
      dept: r.department,
      block: r.hostel_block,
      meal: r.meal_type,
      res_status: r.reservation_status,
      att_status: 'absent'
    };
  });

  data.attendance.forEach(a => {
    const key = `${a.attendance_date}_${a.roll_number}_${a.meal_type}`;
    if (map[key]) {
      map[key].att_status = a.attendance_status;
    } else {
      map[key] = {
        date: a.attendance_date,
        name: a.name,
        roll: a.roll_number,
        dept: a.department,
        block: a.hostel_block,
        meal: a.meal_type,
        res_status: 'no_reservation',
        att_status: a.attendance_status
      };
    }
  });

  Object.values(map).forEach(row => {
    worksheet.addRow(row);
  });

  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  // Strip non-ASCII characters (e.g. em-dash) from filename
  const asciiTitle = title.replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, '_');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename=${asciiTitle}.xlsx`
  );

  await workbook.xlsx.write(res);
  res.end();
}

// Generate PDF
function generatePDFReport(title, data, res) {
  const doc = new PDFDocument({ margin: 30 });

  res.setHeader('Content-Type', 'application/pdf');
  const asciiTitle = title.replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, '_');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename=${asciiTitle}.pdf`
  );

  doc.pipe(res);

  // Title
  doc.fontSize(20).text(title, { align: 'center' });
  doc.moveDown();

  // Summary Metrics
  const totalReservations = data.reservations.filter(r => r.reservation_status === 'confirmed').length;
  const totalPresent = data.attendance.filter(a => a.attendance_status === 'present').length;

  doc.fontSize(12).text(`Summary Statistics:`, { underline: true });
  doc.text(`Total Confirmed Reservations: ${totalReservations}`);
  doc.text(`Total Attended Meals: ${totalPresent}`);
  doc.moveDown();

  // Render Table header
  doc.fontSize(10).text(
    `Date         | Name                | Roll        | Meal       | Res Status | Att Status`,
    { bold: true }
  );
  doc.text(`--------------------------------------------------------------------------------------`);

  // Merge lists to row data
  const map = {};
  data.reservations.forEach(r => {
    const key = `${r.reservation_date}_${r.roll_number}_${r.meal_type}`;
    map[key] = {
      date: r.reservation_date,
      name: r.name,
      roll: r.roll_number,
      meal: r.meal_type,
      res_status: r.reservation_status,
      att_status: 'absent'
    };
  });

  data.attendance.forEach(a => {
    const key = `${a.attendance_date}_${a.roll_number}_${a.meal_type}`;
    if (map[key]) {
      map[key].att_status = a.attendance_status;
    } else {
      map[key] = {
        date: a.attendance_date,
        name: a.name,
        roll: a.roll_number,
        meal: a.meal_type,
        res_status: 'no_reservation',
        att_status: a.attendance_status
      };
    }
  });

  // Limit rendering in PDF to prevent huge files in HTTP stream
  const rows = Object.values(map).slice(0, 100);
  rows.forEach(r => {
    const dateStr = String(r.date).padEnd(12);
    const nameStr = String(r.name).substring(0, 18).padEnd(19);
    const rollStr = String(r.roll).padEnd(11);
    const mealStr = String(r.meal).padEnd(10);
    const resStr = String(r.res_status).padEnd(11);
    const attStr = String(r.att_status);

    doc.text(`${dateStr} | ${nameStr} | ${rollStr} | ${mealStr} | ${resStr} | ${attStr}`);
  });

  if (Object.values(map).length > 100) {
    doc.moveDown();
    doc.text(`... and ${Object.values(map).length - 100} more entries (view Excel sheet for full output)`);
  }

  doc.end();
}

// GET /api/reports/daily
const getDailyReport = async (req, res) => {
  const date = req.query.date || getLocalDateStr();
  const format = req.query.format;

  try {
    const data = await fetchReportData(date, date);
    const title = `Smart Mess Daily Report — ${date}`;

    // Add entry in DB
    await db.query(
      'INSERT INTO reports (report_type, generated_by) VALUES (?, ?)',
      ['daily', req.userId || 0]
    );

    if (format === 'pdf') {
      return generatePDFReport(title, data, res);
    } else if (format === 'excel' || format === 'xlsx') {
      return generateExcelReport(title, data, res);
    }

    res.status(200).json({ title, data });
  } catch (error) {
    console.error('Daily report error:', error);
    res.status(500).json({ error: 'Database connection failed' });
  }
};

// GET /api/reports/weekly
const getWeeklyReport = async (req, res) => {
  const endDate = getLocalDateStr();
  const startDate = getLocalDateStr(-7);
  const format = req.query.format;

  try {
    const data = await fetchReportData(startDate, endDate);
    const title = `Smart Mess Weekly Report — ${startDate} to ${endDate}`;

    // Add entry in DB
    await db.query(
      'INSERT INTO reports (report_type, generated_by) VALUES (?, ?)',
      ['weekly', req.userId || 0]
    );

    if (format === 'pdf') {
      return generatePDFReport(title, data, res);
    } else if (format === 'excel' || format === 'xlsx') {
      return generateExcelReport(title, data, res);
    }

    res.status(200).json({ title, data });
  } catch (error) {
    console.error('Weekly report error:', error);
    res.status(500).json({ error: 'Database connection failed' });
  }
};

// GET /api/reports/monthly
const getMonthlyReport = async (req, res) => {
  const endDate = getLocalDateStr();
  const startDate = getLocalDateStr(-30);
  const format = req.query.format;

  try {
    const data = await fetchReportData(startDate, endDate);
    const title = `Smart Mess Monthly Report — ${startDate} to ${endDate}`;

    // Add entry in DB
    await db.query(
      'INSERT INTO reports (report_type, generated_by) VALUES (?, ?)',
      ['monthly', req.userId || 0]
    );

    if (format === 'pdf') {
      return generatePDFReport(title, data, res);
    } else if (format === 'excel' || format === 'xlsx') {
      return generateExcelReport(title, data, res);
    }

    res.status(200).json({ title, data });
  } catch (error) {
    console.error('Monthly report error:', error);
    res.status(500).json({ error: 'Database connection failed' });
  }
};

module.exports = {
  getDailyReport,
  getWeeklyReport,
  getMonthlyReport
};
