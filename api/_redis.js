// api/_redis.js
import { createClient } from 'redis';
import dotenv from 'dotenv';

dotenv.config(); // Load from .env
console.log('REDIS_URL:', psql 'postgresql://neondb_owner:npg_GITDjUN6YK8V@ep-hidden-wave-a48c3cmv-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require'); // remove after testing

const redis = createClient({ url: psql 'postgresql://neondb_owner:npg_GITDjUN6YK8V@ep-hidden-wave-a48c3cmv-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require' });

redis.on('error', err => console.error('Redis Client Error', err));

await redis.connect();

export default redis;

