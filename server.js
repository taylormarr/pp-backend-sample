require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const sharp = require('sharp');
const { Redis } = require('@upstash/redis');
const OpenAI = require('openai');
const axios = require('axios');
const FormData = require('form-data');

const app = express();
const PORT = process.env.PORT || 3000;

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
    version: '2.1.0 - GPT-4 Vision + DALL-E 3 (Architecture Preserving)',
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

    console.log(`📤 Uploading image for job ${jobId}`);

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

    console.log(`✅ Job ${jobId} uploaded successfully`);

    res.json({
      jobId,
      status: 'uploaded',
      message: 'Image uploaded successfully. Use /api/process/:jobId to start staging.',
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Failed to upload image', details: error.message });
  }
});

// Process endpoint - triggers AI staging
app.post('/api/process/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;

    console.log(`🔄 Processing job ${jobId}`);

    // Get job metadata from Redis
    const jobData = await redis.get(jobId);
    if (!jobData) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const job = typeof jobData === "string" ? JSON.parse(jobData) : jobData;

    // Check if job is too old (more than 5 minutes)
    const jobAge = Date.now() - new Date(job.createdAt).getTime();
    const MAX_JOB_AGE = 5 * 60 * 1000; // 5 minutes

    if (jobAge > MAX_JOB_AGE) {
      console.log(`⏰ Job ${jobId} is too old (${Math.round(jobAge/1000)}s), skipping`);
      job.status = "expired";
      job.error = "Job expired - please upload again";
      await redis.set(jobId, JSON.stringify(job));
      return res.status(410).json({ 
        error: "Job expired", 
        message: "This job is too old. Please upload your image again." 
      });
    }
    
    // Update status to processing
    job.status = 'processing';
    await redis.set(jobId, JSON.stringify(job));

    // Start async processing
    processImageAsync(jobId, job);

    res.json({
      jobId,
      status: 'processing',
      message: 'Image processing started. Check status at /api/job/:jobId',
    });
  } catch (error) {
    console.error('Process error:', error);
    res.status(500).json({ error: 'Failed to start processing', details: error.message });
  }
});

// Helper function to convert buffer to base64 data URL
function bufferToDataUrl(buffer, mimeType = 'image/png') {
  const base64 = buffer.toString('base64');
  return `data:${mimeType};base64,${base64}`;
}

// Async processing function using GPT-4 Vision + DALL-E 3
async function processImageAsync(jobId, job) {
  try {
    console.log(`🎨 Starting AI staging for job ${jobId} (GPT-4 Vision + DALL-E 3)`);

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

    console.log(`📸 Image downloaded (${imageBuffer.length} bytes)`);

    // Step 1: Use GPT-4 Vision to analyze the room
    console.log(`🔍 Step 1: Analyzing room with GPT-4 Vision...`);
    
    const imageDataUrl = bufferToDataUrl(imageBuffer, s3Response.ContentType || 'image/png');
    
    const visionResponse = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Analyze this room image for virtual staging. Describe ONLY what furniture and decor should be added. Do NOT describe the room's existing architecture (walls, windows, floors, ceiling) - I need to preserve those exactly. Focus on: 1) What type of room this is, 2) What furniture pieces would work (sofa, chairs, tables, etc.), 3) What style (modern, traditional, etc.), 4) What colors and materials, 5) What decor items (plants, artwork, rugs, etc.). Be specific about furniture placement and style."
            },
            {
              type: "image_url",
              image_url: {
                url: imageDataUrl
              }
            }
          ]
        }
      ],
      max_tokens: 500
    });

    const furnitureSuggestions = visionResponse.choices[0].message.content;
    console.log(`✅ Furniture suggestions: ${furnitureSuggestions.substring(0, 200)}...`);

    // Step 2: Generate staged image with DALL-E 3 using architecture-preserving prompt
    console.log(`🎨 Step 2: Generating staged image with DALL-E 3...`);
    
    const stagingPrompt = `Virtually stage this room by adding furniture and decor ONLY. CRITICAL: Keep the room's walls, windows, doors, flooring, ceiling, lighting, and all architectural features EXACTLY as shown in the original photo. Do not change the room structure, perspective, or architecture in any way.

Add these furnishings: ${furnitureSuggestions}

The result must look like the same room with furniture added, not a different room. Maintain the exact camera angle, lighting conditions, and room dimensions. Only add furniture, decor, and styling elements.`;
    
    console.log(`📋 DALL-E 3 prompt: ${stagingPrompt.substring(0, 300)}...`);
    
    const dalleResponse = await openai.images.generate({
      model: 'dall-e-3',
      prompt: stagingPrompt,
      n: 1,
      size: '1024x1024',
      quality: 'hd',
    });

    const stagedImageUrl = dalleResponse.data[0].url;
    console.log(`✅ DALL-E 3 generated image`);

    // Download the staged image
    console.log(`📥 Downloading staged image...`);
    const stagedImageResponse = await axios.get(stagedImageUrl, { responseType: 'arraybuffer' });
    const stagedImageBuffer = Buffer.from(stagedImageResponse.data);
    
    console.log(`✅ Downloaded staged image (${stagedImageBuffer.length} bytes)`);

    // Upload staged image to S3
    const outputKey = `outputs/${jobId}/staged_${Date.now()}.png`;
    await s3Client.send(new PutObjectCommand({
      Bucket: process.env.S3_OUTPUTS_BUCKET,
      Key: outputKey,
      Body: stagedImageBuffer,
      ContentType: 'image/png',
    }));

    console.log(`☁️  Uploaded to S3: ${outputKey}`);

    // Update job status
    job.status = 'completed';
    job.stagedImage = outputKey;
    job.completedAt = new Date().toISOString();
    await redis.set(jobId, JSON.stringify(job));

    console.log(`✅ Job ${jobId} completed successfully`);
  } catch (error) {
    console.error(`❌ Job ${jobId} failed:`, error);

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

    const job = typeof jobData === "string" ? JSON.parse(jobData) : jobData;
    res.json(job);
  } catch (error) {
    console.error('Status check error:', error);
    res.status(500).json({ error: 'Failed to check job status', details: error.message });
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

    const job = typeof jobData === "string" ? JSON.parse(jobData) : jobData;

    if (job.status !== 'completed') {
      return res.status(400).json({ error: 'Job not completed yet', status: job.status });
    }

    // Get staged image from S3
    const s3Response = await s3Client.send(new GetObjectCommand({
      Bucket: process.env.S3_OUTPUTS_BUCKET,
      Key: job.stagedImage,
    }));

    // Convert stream to buffer
    const chunks = [];
    for await (const chunk of s3Response.Body) {
      chunks.push(chunk);
    }
    const imageBuffer = Buffer.concat(chunks);

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="staged_${jobId}.png"`);
    res.send(imageBuffer);
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: 'Failed to download image', details: error.message });
  }
});

// Mailgun webhook endpoint
app.post('/api/webhook/mailgun', async (req, res) => {
  try {
    console.log('📧 Received Mailgun webhook');
    
    // TODO: Implement email processing
    // 1. Extract attachments from email
    // 2. Upload to S3
    // 3. Create job
    // 4. Process image
    // 5. Send result back via email
    
    res.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Property Perfected API running on port ${PORT}`);
  console.log(`🤖 Using GPT-4 Vision + DALL-E 3 for staging (Architecture Preserving)`);
});
