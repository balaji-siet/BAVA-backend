const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_mess_token_123!';
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'shakthi_mess_supervisor_token_xyz';

// Middleware to verify student JWT token
const verifyToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    req.userId = decoded.studentId;
    req.userRoll = decoded.rollNumber;
    req.userRole = decoded.role || 'student';
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Invalid or expired token.' });
  }
};

// Middleware to verify admin/supervisor access
const verifyAdmin = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  // Option 1: Direct comparison with pre-shared ADMIN_SECRET
  if (token === ADMIN_SECRET) {
    req.userRole = 'admin';
    return next();
  }

  // Option 2: Verify if JWT was signed for an admin user
  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    if (decoded.role === 'admin' || decoded.isAdmin) {
      req.userId = decoded.studentId || 0;
      req.userRole = 'admin';
      next();
    } else {
      return res.status(403).json({ error: 'Access denied. Supervisor privileges required.' });
    }
  } catch (err) {
    // If JWT verification fails, check if the raw token is the ADMIN_SECRET (without Bearer prefix just in case)
    if (token === ADMIN_SECRET) {
      req.userRole = 'admin';
      return next();
    }
    return res.status(403).json({ error: 'Invalid or expired credentials.' });
  }
};

module.exports = {
  verifyToken,
  verifyAdmin
};
