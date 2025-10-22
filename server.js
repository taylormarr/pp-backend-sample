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

// Initialize Sentry
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENV || 'production',
  tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '1.0'),
  profilesSampleRate: parseFloat(process.env.SENTRY_PROFILES_SAMPLE_RATE || '1.0'),
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(Sentry.Handlers.requestHandler());
app.use(express.static('public'));

// Configure AWS S3
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-2',
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
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Health check endpoint
app.get('/', (req, res) => {
  res.send('Property Perfected backend is running ✅');
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    services: {
      s3: !!process.env.AWS_ACCESS_KEY_ID,
      redis: !!process.env.UPSTASH_REDIS_REST_URL,
      openai: !!process.env.OPENAI_API_KEY,
      sentry: !!process.env.SENTRY_DSN,
    }
  });
});

// Upload endpoint
app.post('/api/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    const userEmail = req.body.email || 'test@propertyperfected.com';
    const fileName = `${Date.now()}-${req.file.originalname}`;
    const s3Key = `uploads/${fileName}`;

    // Upload to S3
    const uploadParams = {
      Bucket: process.env.S3_UPLOADS_BUCKET,
      Key: s3Key,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
    };

    await s3Client.send(new PutObjectCommand(uploadParams));
    console.log(`✅ Uploaded to S3: ${s3Key}`);

    // Create job in Redis
    const jobId = `job-${Date.now()}`;
    const jobData = {
      jobId,
      s3Key,
      fileName,
      userEmail,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    await redis.set(jobId, JSON.stringify(jobData));
    await redis.lpush('staging-queue', jobId);
    console.log(`✅ Job queued: ${jobId}`);

    res.json({
      success: true,
      jobId,
      message: 'Image uploaded and queued for staging',
      s3Key,
    });

  } catch (error) {
    console.error('Upload error:', error);
    Sentry.captureException(error);
    res.status(500).json({ error: 'Upload failed', details: error.message });
  }
});

// Process staging job
app.post('/api/process/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    
    // Get job from Redis
    const jobDataStr = await redis.get(jobId);
    if (!jobDataStr) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const jobData = JSON.parse(jobDataStr);
    
    // Update job status
    jobData.status = 'processing';
    await redis.set(jobId, JSON.stringify(jobData));

    // Get original image from S3
    const getParams = {
      Bucket: process.env.S3_UPLOADS_BUCKET,
      Key: jobData.s3Key,
    };
    
    const s3Response = await s3Client.send(new GetObjectCommand(getParams));
    const imageBuffer = await streamToBuffer(s3Response.Body);
    const base64Image = imageBuffer.toString('base64');
    const mimeType = s3Response.ContentType || 'image/jpeg';
    const dataUrl = `data:${mimeType};base64,${base64Image}`;

    console.log(`✅ Retrieved image from S3: ${jobData.s3Key}`);

    // Generate staged image with OpenAI DALL-E
    const prompt = `Transform this empty room into a beautifully staged, professionally furnished living space. Add modern, elegant furniture including a comfortable sofa, stylish coffee table, decorative items, plants, and artwork. Maintain the room's architecture, windows, and lighting. Create a warm, inviting atmosphere that would appeal to home buyers. Keep the style contemporary and neutral.`;

    console.log('🎨 Calling OpenAI DALL-E for staging...');
    
    const response = await openai.images.edit({
      model: process.env.OPENAI_IMAGE_MODEL || 'dall-e-2',
      image: imageBuffer,
      prompt: prompt,
      n: 1,
      size: '1024x1024',
    });

    const stagedImageUrl = response.data[0].url;
    console.log(`✅ Generated staged image: ${stagedImageUrl}`);

    // Download staged image
    const imageResponse = await axios.get(stagedImageUrl, { responseType: 'arraybuffer' });
    const stagedImageBuffer = Buffer.from(imageResponse.data);

    // Upload staged image to S3 outputs bucket
    const outputFileName = `staged-${jobData.fileName}`;
    const outputS3Key = `outputs/${outputFileName}`;
    
    const outputParams = {
      Bucket: process.env.S3_OUTPUTS_BUCKET,
      Key: outputS3Key,
      Body: stagedImageBuffer,
      ContentType: 'image/png',
    };

    await s3Client.send(new PutObjectCommand(outputParams));
    console.log(`✅ Saved staged image to S3: ${outputS3Key}`);

    // Update job with results
    jobData.status = 'completed';
    jobData.outputS3Key = outputS3Key;
    jobData.completedAt = new Date().toISOString();
    await redis.set(jobId, JSON.stringify(jobData));

    res.json({
      success: true,
      jobId,
      status: 'completed',
      originalImage: jobData.s3Key,
      stagedImage: outputS3Key,
      downloadUrl: `${process.env.BACKEND_URL || 'http://localhost:3000'}/api/download/${jobId}`,
    });

  } catch (error) {
    console.error('Processing error:', error);
    Sentry.captureException(error);
    
    // Update job status to failed
    try {
      const jobDataStr = await redis.get(req.params.jobId);
      if (jobDataStr) {
        const jobData = JSON.parse(jobDataStr);
        jobData.status = 'failed';
        jobData.error = error.message;
        await redis.set(req.params.jobId, JSON.stringify(jobData));
      }
    } catch (updateError) {
      console.error('Failed to update job status:', updateError);
    }

    res.status(500).json({ error: 'Processing failed', details: error.message });
  }
});

// Get job status
app.get('/api/job/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const jobDataStr = await redis.get(jobId);
    
    if (!jobDataStr) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const jobData = JSON.parse(jobDataStr);
    res.json(jobData);

  } catch (error) {
    console.error('Job status error:', error);
    Sentry.captureException(error);
    res.status(500).json({ error: 'Failed to get job status' });
  }
});

// Download staged image
app.get('/api/download/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const jobDataStr = await redis.get(jobId);
    
    if (!jobDataStr) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const jobData = JSON.parse(jobDataStr);
    
    if (jobData.status !== 'completed' || !jobData.outputS3Key) {
      return res.status(400).json({ error: 'Staged image not ready' });
    }

    // Get staged image from S3
    const getParams = {
      Bucket: process.env.S3_OUTPUTS_BUCKET,
      Key: jobData.outputS3Key,
    };
    
    const s3Response = await s3Client.send(new GetObjectCommand(getParams));
    const imageBuffer = await streamToBuffer(s3Response.Body);

    res.set('Content-Type', s3Response.ContentType || 'image/png');
    res.set('Content-Disposition', `attachment; filename="${jobData.outputS3Key.split('/').pop()}"`);
    res.send(imageBuffer);

  } catch (error) {
    console.error('Download error:', error);
    Sentry.captureException(error);
    res.status(500).json({ error: 'Download failed' });
  }
});

// Mailgun webhook endpoint for inbound emails
app.post('/api/webhook/mailgun', upload.any(), async (req, res) => {
  try {
    console.log('📧 Received Mailgun webhook');
    
    const sender = req.body.sender || req.body.from;
    const subject = req.body.subject || 'Property Staging Request';
    
    // Process attached images
    const attachments = req.files || [];
    const jobIds = [];

    for (const file of attachments) {
      if (file.mimetype.startsWith('image/')) {
        const fileName = `${Date.now()}-${file.originalname}`;
        const s3Key = `uploads/${fileName}`;

        // Upload to S3
        const uploadParams = {
          Bucket: process.env.S3_UPLOADS_BUCKET,
          Key: s3Key,
          Body: file.buffer,
          ContentType: file.mimetype,
        };

        await s3Client.send(new PutObjectCommand(uploadParams));

        // Create job
        const jobId = `job-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const jobData = {
          jobId,
          s3Key,
          fileName,
          userEmail: sender,
          status: 'pending',
          source: 'email',
          createdAt: new Date().toISOString(),
        };

        await redis.set(jobId, JSON.stringify(jobData));
        await redis.lpush('staging-queue', jobId);
        jobIds.push(jobId);
        
        console.log(`✅ Email attachment queued: ${jobId}`);
      }
    }

    res.json({ 
      success: true, 
      message: `Received ${jobIds.length} images`,
      jobIds 
    });

  } catch (error) {
    console.error('Mailgun webhook error:', error);
    Sentry.captureException(error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Helper function to convert stream to buffer
async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// Sentry error handler
app.use(Sentry.Handlers.errorHandler());

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Property Perfected backend running on port ${PORT}`);
  console.log(`✅ S3 Uploads Bucket: ${process.env.S3_UPLOADS_BUCKET}`);
  console.log(`✅ S3 Outputs Bucket: ${process.env.S3_OUTPUTS_BUCKET}`);
  console.log(`✅ OpenAI Model: ${process.env.OPENAI_IMAGE_MODEL || 'dall-e-2'}`);
  console.log(`✅ Redis: Connected`);
  console.log(`✅ Sentry: Monitoring enabled`);
});
