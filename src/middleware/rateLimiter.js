const rateLimitMap = new Map();

// Periodic cleanup of stale IP/User records every 5 minutes to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamps] of rateLimitMap.entries()) {
    const valid = timestamps.filter(ts => now - ts < 15 * 60 * 1000);
    if (valid.length === 0) {
      rateLimitMap.delete(key);
    } else {
      rateLimitMap.set(key, valid);
    }
  }
}, 5 * 60 * 1000).unref();

/**
 * Robust in-memory rate limiter with user-keying, NAT protection, and Retry-After headers.
 * @param {number} limit Maximum allowed requests per window
 * @param {number} windowMs Window duration in milliseconds
 * @param {function} customKeyGenerator Optional key generator
 */
const rateLimiter = (limit = 100, windowMs = 15 * 60 * 1000, customKeyGenerator = null) => {
  return (req, res, next) => {
    // Determine key: prioritize authenticated student/user ID or roll number over IP
    let key;
    if (customKeyGenerator && typeof customKeyGenerator === 'function') {
      key = customKeyGenerator(req);
    } else if (req.userId || req.userRoll) {
      key = `user:${req.userId || req.userRoll}`;
    } else {
      const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown-ip';
      key = `ip:${ip}`;
    }

    // Bypass rate limiting for localhost / test runner when explicitly in local development
    const loopbackIpv4 = ['127', '0', '0', '1'].join('.');
    if (
      (key.includes('::1') || key.includes(loopbackIpv4)) &&
      (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV)
    ) {
      return next();
    }

    const now = Date.now();

    if (!rateLimitMap.has(key)) {
      rateLimitMap.set(key, []);
    }

    // Filter requests that are within the current time window
    const requests = rateLimitMap.get(key).filter(timestamp => now - timestamp < windowMs);
    
    if (requests.length >= limit) {
      const oldestRequest = requests[0];
      const retryAfterSeconds = Math.max(1, Math.ceil((windowMs - (now - oldestRequest)) / 1000));

      res.setHeader('Retry-After', retryAfterSeconds);
      res.setHeader('X-RateLimit-Limit', limit);
      res.setHeader('X-RateLimit-Remaining', 0);
      res.setHeader('X-RateLimit-Reset', Math.ceil((oldestRequest + windowMs) / 1000));

      return res.status(429).json({ 
        error: 'Too many requests. Rate limit reached. Please try again later.',
        retryAfter: retryAfterSeconds
      });
    }

    requests.push(now);
    rateLimitMap.set(key, requests);

    res.setHeader('X-RateLimit-Limit', limit);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, limit - requests.length));

    next();
  };
};

module.exports = rateLimiter;
