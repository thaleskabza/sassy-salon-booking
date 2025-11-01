// api/_redis.js
import { createClient } from 'redis';
import dotenv from 'dotenv';

dotenv.config(); // Load from .env


const redis = createClient({ url: 'redis://default:90OkLfPmsYWfCN5owDQD5nz68UtCRWNQ@redis-14864.c82.us-east-1-2.ec2.redns.redis-cloud.com:14864' });

redis.on('error', err => console.error('Redis Client Error', err));

await redis.connect();

export default redis;

