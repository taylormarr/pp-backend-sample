require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { Redis } = require('@upstash/redis');
const OpenAI = require('openai');
const Sentry = require('@sentry/node');
const axios = require('axios');
const FormData = require('form-data');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Sentry only if DSN is provided
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENV || 'production',
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '1.0'),
    profilesSampleRate: parseFloat(process.env.SENTRY_PROFILES_SAMPLE_RATE || '1.0'),
  });
  app.use(Sentry.Handlers.requestHandler());
  console.log('✅ Sentry initialized');
} else {
  console.log('⚠️  Sentry DSN not provided, skipping Sentry initialization');
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Configure AWS S3
const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Configure Upstash Redis
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Configure OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  organization: process.env.OPENAI_ORG_ID,
});

// Configure Multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});

// Health check endpoint
app.get('/health', async (req, res) => {
  res.json({ ok: true });
});

app.get('/', (req, res) => {
  res.json({ 
    status: 'Property Perfected API is running',
    endpoints: {
      upload: 'POST /api/upload',
      process: 'POST /api/process/:jobId',
      status: 'GET /api/job/:jobId',
      download: 'GET /api/download/:jobId',
      webhook: 'POST /api/webhook/mailgun'
    }
  });
});

// Upload endpoint
app.post('/api/upload', upload.single('image'), async (req, res) => {
  try {
    const { email } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    // Generate unique job ID
    const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const s3Key = `uploads/${jobId}/${file.originalname}`;

    // Upload to S3
    await s3Client.send(new PutObjectCommand({
      Bucket: process.env.S3_UPLOADS_BUCKET,
      Key: s3Key,
      Body: file.buffer,
      ContentType: file.mimetype,
    }));

    // Store job metadata in Redis
    await redis.set(jobId, JSON.stringify({
      jobId,
      email,
      originalImage: s3Key,
      status: 'uploaded',
      createdAt: new Date().toISOString(),
    }));

    res.json({
      jobId,
      status: 'uploaded',
      message: 'Image uploaded successfully. Use /api/process/:jobId to start staging.',
    });
  } catch (error) {
    console.error('Upload error:', error);
    if (process.env.SENTRY_DSN) Sentry.captureException(error);
    res.status(500).json({ error: 'Failed to upload image' });
  }
});

// Process endpoint - triggers AI staging
app.post('/api/process/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;

    // Get job metadata from Redis
    const jobData = await redis.get(jobId);
    if (!jobData) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const job = JSON.parse(jobData);

    // Update status to processing
    job.status = 'processing';
    await redis.set(jobId, JSON.stringify(job));

    // Start async processing (in production, use a queue worker)
    processImageAsync(jobId, job);

    res.json({
      jobId,
      status: 'processing',
      message: 'Image processing started. Check status at /api/job/:jobId',
    });
  } catch (error) {
    console.error('Process error:', error);
    if (process.env.SENTRY_DSN) Sentry.captureException(error);
    res.status(500).json({ error: 'Failed to start processing' });
  }
});

// Async processing function
async function processImageAsync(jobId, job) {
  try {
    // Download image from S3
    const s3Response = await s3Client.send(new GetObjectCommand({
      Bucket: process.env.S3_UPLOADS_BUCKET,
      Key: job.originalImage,
    }));

    // Convert stream to buffer
    const chunks = [];
    for await (const chunk of s3Response.Body) {
      chunks.push(chunk);
    }
    const imageBuffer = Buffer.concat(chunks);

    // Convert to base64 for OpenAI
    const base64Image = imageBuffer.toString('base64');
    const imageUrl = `data:${s3Response.ContentType};base64,${base64Image}`;

    // Call OpenAI DALL-E for staging
    const response = await openai.images.edit({
      model: process.env.OPENAI_IMAGE_MODEL || 'dall-e-2',
      image: imageBuffer,
      prompt: 'Transform this empty room into a beautifully staged, professionally furnished space. Add modern furniture, tasteful decor, proper lighting, and create an inviting atmosphere that would appeal to potential home buyers. Maintain the room\'s architecture and structure.',
      n: 1,
      size: '1024x1024',
    });

    const stagedImageUrl = response.data[0].url;

    // Download staged image
    const stagedImageResponse = await axios.get(stagedImageUrl, { responseType: 'arraybuffer' });
    const stagedImageBuffer = Buffer.from(stagedImageResponse.data);

    // Upload staged image to S3
    const outputKey = `outputs/${jobId}/staged_${Date.now()}.png`;
    await s3Client.send(new PutObjectCommand({
      Bucket: process.env.S3_OUTPUTS_BUCKET,
      Key: outputKey,
      Body: stagedImageBuffer,
      ContentType: 'image/png',
    }));

    // Update job status
    job.status = 'completed';
    job.stagedImage = outputKey;
    job.completedAt = new Date().toISOString();
    await redis.set(jobId, JSON.stringify(job));

    console.log(`✅ Job ${jobId} completed successfully`);
  } catch (error) {
    console.error(`❌ Job ${jobId} failed:`, error);
    if (process.env.SENTRY_DSN) Sentry.captureException(error);

    // Update job status to failed
    job.status = 'failed';
    job.error = error.message;
    await redis.set(jobId, JSON.stringify(job));
  }
}

// Job status endpoint
app.get('/api/job/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const jobData = await redis.get(jobId);

    if (!jobData) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json(JSON.parse(jobData));
  } catch (error) {
    console.error('Status check error:', error);
    if (process.env.SENTRY_DSN) Sentry.captureException(error);
    res.status(500).json({ error: 'Failed to check job status' });
  }
});

// Download endpoint
app.get('/api/download/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const jobData = await redis.get(jobId);

    if (!jobData) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const job = JSON.parse(jobData);

    if (job.status !== 'completed') {
      return res.status(400).json({ error: 'Job not completed yet', status: job.status });
    }

    // Get staged image from S3
    const s3Response = await s3Client.send(new GetObjectCommand({
      Bucket: process.env.S3_OUTPUTS_BUCKET,
      Key: job.stagedImage,
    }));

    // Stream the image to response
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="staged_${jobId}.png"`);
    
    for await (const chunk of s3Response.Body) {
      res.write(chunk);
    }
    res.end();
  } catch (error) {
    console.error('Download error:', error);
    if (process.env.SENTRY_DSN) Sentry.captureException(error);
    res.status(500).json({ error: 'Failed to download image' });
  }
});

// Mailgun webhook endpoint
app.post('/api/webhook/mailgun', upload.any(), async (req, res) => {
  try {
    const { sender } = req.body;
    const attachments = req.files;

    if (!attachments || attachments.length === 0) {
      return res.status(400).json({ error: 'No attachments found' });
    }

    // Process first image attachment
    const imageFile = attachments.find(f => f.mimetype.startsWith('image/'));
    if (!imageFile) {
      return res.status(400).json({ error: 'No image attachment found' });
    }

    // Generate job ID
    const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const s3Key = `uploads/${jobId}/${imageFile.originalname}`;

    // Upload to S3
    await s3Client.send(new PutObjectCommand({
      Bucket: process.env.S3_UPLOADS_BUCKET,
      Key: s3Key,
      Body: imageFile.buffer,
      ContentType: imageFile.mimetype,
    }));

    // Store job metadata
    const job = {
      jobId,
      email: sender,
      originalImage: s3Key,
      status: 'processing',
      createdAt: new Date().toISOString(),
    };
    await redis.set(jobId, JSON.stringify(job));

    // Start processing
    processImageAsync(jobId, job);

    res.json({ jobId, status: 'processing' });
  } catch (error) {
    console.error('Webhook error:', error);
    if (process.env.SENTRY_DSN) Sentry.captureException(error);
    res.status(500).json({ error: 'Failed to process webhook' });
  }
});

// Error handler (Sentry)
if (process.env.SENTRY_DSN) {
  app.use(Sentry.Handlers.errorHandler());
}

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Property Perfected API running on port ${PORT}`);
  console.log(`📍 Environment: ${process.env.SENTRY_ENV || 'production'}`);
  console.log(`🔑 OpenAI Model: ${process.env.OPENAI_IMAGE_MODEL || 'dall-e-2'}`);
});
