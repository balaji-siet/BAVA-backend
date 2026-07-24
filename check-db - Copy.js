const db = require('./src/config/db');

async function check() {
  try {
    const [students] = await db.query('SELECT * FROM Students');
    console.log('Students count:', students ? students.length : 0);
    if (students && students.length > 0) {
      console.log('Sample student:', students[0]);
    }
    
    const [supervisors] = await db.query('SELECT * FROM Supervisors');
    console.log('Supervisors count:', supervisors ? supervisors.length : 0);
    if (supervisors && supervisors.length > 0) {
      console.log('Sample supervisor:', supervisors[0]);
    }
  } catch (err) {
    console.error('Error during check:', err);
  }
}

check();
