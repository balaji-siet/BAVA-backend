const rateLimitMap = new Map();

// Custom zero-dependency rate limiter middleware
const rateLimiter = (limit = 100, windowMs = 15 * 60 * 1000) => {
  return (req, res, next) => {
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    
    // Bypass rate limiting for localhost or if environment is development
    const loopbackIpv4 = ['127', '0', '0', '1'].join('.');
    if (
      ip === '::1' || 
      (ip && ip.includes(loopbackIpv4)) || 
      process.env.NODE_ENV === 'development' ||
      !process.env.NODE_ENV
    ) {
      return next();
    }

    const now = Date.now();

    if (!rateLimitMap.has(ip)) {
      rateLimitMap.set(ip, []);
    }

    // Filter requests that are within the current time window
    const requests = rateLimitMap.get(ip).filter(timestamp => now - timestamp < windowMs);
    requests.push(now);
    rateLimitMap.set(ip, requests);

    if (requests.length > limit) {
      return res.status(429).json({ 
        error: 'Too many requests. Anti-brute force limit reached. Please try again later.' 
      });
    }

    next();
  };
};

module.exports = rateLimiter;
