// api/_redis.js
import { createClient } from 'redis';
import dotenv from 'dotenv';

dotenv.config(); // Load from .env
console.log('REDIS_URL:', process.env.REDIS_URL); // remove after testing

const redis = createClient({ url: process.env.REDIS_URL });

redis.on('error', err => console.error('Redis Client Error', err));

await redis.connect();

export default redis;

