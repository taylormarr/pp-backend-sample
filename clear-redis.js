const { Redis } = require('@upstash/redis');
require('dotenv').config();

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

async function clearJobs() {
  console.log('🧹 Clearing all jobs from Redis...');
  
  // This will clear all keys (be careful in production!)
  const keys = await redis.keys('job_*');
  console.log(`Found ${keys.length} jobs to clear`);
  
  for (const key of keys) {
    await redis.del(key);
    console.log(`  ✅ Deleted ${key}`);
  }
  
  console.log('✅ All jobs cleared!');
}

clearJobs().catch(console.error);
