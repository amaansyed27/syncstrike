import Redis from 'ioredis';
import dotenv from 'dotenv';
dotenv.config();

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

export const redis = new Redis(redisUrl);
export const pubClient = new Redis(redisUrl);
export const subClient = pubClient.duplicate();

redis.on('error', (err) => console.error('Redis Client Error', err));
