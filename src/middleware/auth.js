const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_mess_token_123!';
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'shakthi_mess_supervisor_token_xyz';

const normalizeTokenRole = (role) => {
  if (typeof role !== 'string') return null;
  const normalized = role.toLowerCase().trim();
  if (normalized === 'student') return 'student';
  if (normalized === 'supervisor' || normalized === 'admin' || normalized === 'manager') return normalized;
  return null;
};

// Middleware to verify student JWT token
const verifyToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    const role = normalizeTokenRole(decoded.role);
    if (!role) {
      return res.status(401).json({ error: 'Invalid token role. Please login again.' });
    }
    req.userId = decoded.studentId;
    req.userRoll = decoded.rollNumber;
    req.userRole = role;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'JWT expired. Please login again.' });
    }
    return res.status(401).json({ error: 'Invalid token. Please login again.' });
  }
};

// Middleware to verify admin/supervisor access
const verifyAdmin = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  // Option 1: Direct comparison with pre-shared ADMIN_SECRET (non-production debug override)
  if (process.env.NODE_ENV !== 'production' && token === ADMIN_SECRET) {
    req.userRole = 'admin';
    return next();
  }

  // Option 2: Verify signed JWT for an admin/supervisor user
  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    const normRole = normalizeTokenRole(decoded.role);
    if (normRole === 'admin' || normRole === 'supervisor' || normRole === 'manager') {
      req.userId = decoded.studentId || 0;
      req.userRole = normRole;
      next();
    } else {
      return res.status(403).json({ error: 'Access denied. Supervisor privileges required.' });
    }
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'JWT expired. Please login again.' });
    }
    return res.status(401).json({ error: 'Invalid token. Please login again.' });
  }
};

module.exports = {
  verifyToken,
  verifyAdmin
};
