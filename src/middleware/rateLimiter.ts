import { Request, Response, NextFunction } from 'express';

interface RateLimitStore {
  [key: string]: {
    count: number;
    resetTime: number;
  };
}

const store: RateLimitStore = {};
const WINDOW_SIZE = 15 * 60 * 1000; // 15 minutes
const MAX_REQUESTS = 100; // per window

export const rateLimiter = (req: Request, res: Response, next: NextFunction) => {
  const clientId = req.ip || 'unknown';
  const now = Date.now();
  
  // Clean up expired entries
  Object.keys(store).forEach(key => {
    if (store[key].resetTime < now) {
      delete store[key];
    }
  });

  if (!store[clientId]) {
    store[clientId] = {
      count: 1,
      resetTime: now + WINDOW_SIZE
    };
    return next();
  }

  if (store[clientId].resetTime < now) {
    store[clientId] = {
      count: 1,
      resetTime: now + WINDOW_SIZE
    };
    return next();
  }

  store[clientId].count++;

  if (store[clientId].count > MAX_REQUESTS) {
    return res.status(429).json({
      success: false,
      error: {
        message: 'Too many requests, please try again later',
        retryAfter: Math.ceil((store[clientId].resetTime - now) / 1000)
      }
    });
  }

  next();
};