// Add this check after line 125 (after parsing the job)

const job = typeof jobData === "string" ? JSON.parse(jobData) : jobData;

// Check if job is too old (more than 5 minutes)
const jobAge = Date.now() - new Date(job.createdAt).getTime();
const MAX_JOB_AGE = 5 * 60 * 1000; // 5 minutes

if (jobAge > MAX_JOB_AGE) {
  console.log(`⏰ Job ${jobId} is too old (${Math.round(jobAge/1000)}s), skipping`);
  job.status = 'expired';
  job.error = 'Job expired - please upload again';
  await redis.set(jobId, JSON.stringify(job));
  return res.status(410).json({ 
    error: 'Job expired', 
    message: 'This job is too old. Please upload your image again.' 
  });
}

// Continue with normal processing...
