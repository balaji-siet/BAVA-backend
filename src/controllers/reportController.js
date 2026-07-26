const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const Student = require('../models/Student');
const Reservation = require('../models/Reservation');
const Attendance = require('../models/Attendance');

function getLocalDateStr(offsetDays = 0) {
  const date = new Date();
  if (offsetDays !== 0) {
    date.setDate(date.getDate() + offsetDays);
  }
  return date.toISOString().split('T')[0];
}

async function fetchReportData(startDate, endDate) {
  const reservations = await Reservation.find({
    reservation_date: { $gte: startDate, $lte: endDate }
  }).populate('student_id', 'name roll_number hostel_block department');

  const attendance = await Attendance.find({
    attendance_date: { $gte: startDate, $lte: endDate }
  }).populate('student_id', 'name roll_number hostel_block department');

  return {
    reservations,
    attendance
  };
}

async function generateExcelReport(title, data, res) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Report');

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

  const map = {};
  data.reservations.forEach(r => {
    const std = r.student_id || {};
    const key = `${r.reservation_date}_${r.roll_number}_breakfast`;
    map[key] = {
      date: r.reservation_date,
      name: std.name || 'Student',
      roll: r.roll_number || std.roll_number || 'N/A',
      dept: std.department || 'General',
      block: std.hostel_block || 'A',
      meal: 'breakfast',
      res_status: r.breakfast ? 'confirmed' : 'cancelled',
      att_status: 'absent'
    };
  });

  data.attendance.forEach(a => {
    const std = a.student_id || {};
    const key = `${a.attendance_date}_${a.roll_number}_${a.meal_type}`;
    if (map[key]) {
      map[key].att_status = a.attendance_status;
    } else {
      map[key] = {
        date: a.attendance_date,
        name: std.name || 'Student',
        roll: a.roll_number || std.roll_number || 'N/A',
        dept: std.department || 'General',
        block: std.hostel_block || 'A',
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
  const asciiTitle = title.replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, '_');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename=${asciiTitle}.xlsx`
  );

  await workbook.xlsx.write(res);
  res.end();
}

async function generatePDFReport(title, data, res) {
  const doc = new PDFDocument({ margin: 30, size: 'A4' });
  const asciiTitle = title.replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, '_');

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename=${asciiTitle}.pdf`
  );

  doc.pipe(res);

  doc.fontSize(18).text(title, { align: 'center' });
  doc.moveDown();
  doc.fontSize(12).text(`Generated on: ${new Date().toLocaleString()}`);
  doc.moveDown();

  const totalReservations = data.reservations.length;
  const totalAttendance = data.attendance.length;

  doc.fontSize(14).text('Summary Statistics:', { underline: true });
  doc.fontSize(12).text(`Total Reservations: ${totalReservations}`);
  doc.text(`Total Attendance Records: ${totalAttendance}`);
  doc.moveDown();

  doc.end();
}

const getDailyReport = async (req, res) => {
  const format = req.query.format || 'json';
  const today = getLocalDateStr(0);

  try {
    const data = await fetchReportData(today, today);

    if (format === 'excel') {
      return generateExcelReport(`Daily_Report_${today}`, data, res);
    } else if (format === 'pdf') {
      return generatePDFReport(`Daily_Report_${today}`, data, res);
    }

    res.status(200).json({ date: today, ...data });
  } catch (error) {
    console.error('Daily report error:', error);
    res.status(500).json({ error: 'Database error generating report' });
  }
};

const getWeeklyReport = async (req, res) => {
  const format = req.query.format || 'json';
  const startDate = getLocalDateStr(-7);
  const endDate = getLocalDateStr(0);

  try {
    const data = await fetchReportData(startDate, endDate);

    if (format === 'excel') {
      return generateExcelReport(`Weekly_Report_${startDate}_to_${endDate}`, data, res);
    } else if (format === 'pdf') {
      return generatePDFReport(`Weekly_Report_${startDate}_to_${endDate}`, data, res);
    }

    res.status(200).json({ startDate, endDate, ...data });
  } catch (error) {
    console.error('Weekly report error:', error);
    res.status(500).json({ error: 'Database error generating report' });
  }
};

const getMonthlyReport = async (req, res) => {
  const format = req.query.format || 'json';
  const startDate = getLocalDateStr(-30);
  const endDate = getLocalDateStr(0);

  try {
    const data = await fetchReportData(startDate, endDate);

    if (format === 'excel') {
      return generateExcelReport(`Monthly_Report_${startDate}_to_${endDate}`, data, res);
    } else if (format === 'pdf') {
      return generatePDFReport(`Monthly_Report_${startDate}_to_${endDate}`, data, res);
    }

    res.status(200).json({ startDate, endDate, ...data });
  } catch (error) {
    console.error('Monthly report error:', error);
    res.status(500).json({ error: 'Database error generating report' });
  }
};

module.exports = {
  getDailyReport,
  getWeeklyReport,
  getMonthlyReport
};
