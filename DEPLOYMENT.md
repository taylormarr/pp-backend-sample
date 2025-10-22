# Property Perfected - Deployment Checklist

## ✅ Pre-Deployment Checklist

### 1. AWS S3 Setup
- [x] Create S3 bucket: `pp-uploads-prod-twm` (us-east-2)
- [x] Create S3 bucket: `pp-outputs-prod-twm` (us-east-2)
- [x] Create IAM user: `pp-prod-uploader`
- [x] Configure IAM policy for bucket access
- [ ] Verify bucket permissions (private, IAM-only access)

### 2. OpenAI Configuration
- [x] OpenAI API key obtained
- [x] Organization ID: `org-3UauwEtEsiJNpTBGrmqm5KUw`
- [x] Model: `dall-e-2` (or `gpt-image-1`)
- [ ] Test API key with sample request

### 3. Upstash Redis Setup
- [x] Create Redis database: `pp-prod`
- [x] Region: Ohio, USA
- [x] Get REST URL and token
- [ ] Test Redis connection

### 4. Sentry Monitoring
- [x] Create Sentry project: `property-perfected-backend`
- [x] Get DSN
- [ ] Send test event to verify

### 5. Mailgun Email Integration
- [ ] Get Mailgun API key
- [ ] Configure domain
- [ ] Set up inbound route: `staging@photos.propertyperfected.com`
- [ ] Configure webhook URL: `https://your-backend.onrender.com/api/webhook/mailgun`

## 🚀 Render Deployment

### Step 1: Create Render Web Service
1. Go to [Render Dashboard](https://dashboard.render.com)
2. Click "New +" → "Web Service"
3. Connect GitHub repository: `pp-backend-sample`
4. Configure:
   - **Name**: `property-perfected-backend`
   - **Environment**: Node
   - **Build Command**: `npm install` or `bun install`
   - **Start Command**: `node server.js`
   - **Plan**: Free (for testing) or Starter

### Step 2: Set Environment Variables

In Render dashboard, add these environment variables:

```
OPENAI_API_KEY=<your-openai-key>
OPENAI_ORG_ID=org-3UauwEtEsiJNpTBGrmqm5KUw
OPENAI_IMAGE_MODEL=dall-e-2

AWS_ACCESS_KEY_ID=<your-aws-key>
AWS_SECRET_ACCESS_KEY=<your-aws-secret>
AWS_REGION=us-east-2
S3_UPLOADS_BUCKET=pp-uploads-prod-twm
S3_OUTPUTS_BUCKET=pp-outputs-prod-twm

UPSTASH_REDIS_REST_URL=<your-redis-url>
UPSTASH_REDIS_REST_TOKEN=<your-redis-token>

SENTRY_DSN=<your-sentry-dsn>
SENTRY_ENV=production
SENTRY_TRACES_SAMPLE_RATE=1.0
SENTRY_PROFILES_SAMPLE_RATE=1.0

MAILGUN_API_KEY=<your-mailgun-key>
MAILGUN_DOMAIN=<your-mailgun-domain>

PORT=3000
BACKEND_URL=https://property-perfected-backend.onrender.com

AUTH_PROVIDER=none
```

### Step 3: Deploy
1. Click "Create Web Service"
2. Wait for deployment (5-10 minutes)
3. Verify at: `https://property-perfected-backend.onrender.com`

## 🧪 Post-Deployment Testing

### Test 1: Health Check
```bash
curl https://property-perfected-backend.onrender.com/health
```

Expected response:
```json
{
  "status": "healthy",
  "timestamp": "2025-10-21T...",
  "services": {
    "s3": true,
    "redis": true,
    "openai": true,
    "sentry": true
  }
}
```

### Test 2: Upload Image
```bash
curl -X POST https://property-perfected-backend.onrender.com/api/upload \
  -F "image=@test-room.png" \
  -F "email=test@propertyperfected.com"
```

Expected response:
```json
{
  "success": true,
  "jobId": "job-1729545600000",
  "message": "Image uploaded and queued for staging",
  "s3Key": "uploads/1729545600000-test-room.png"
}
```

### Test 3: Process Job
```bash
curl -X POST https://property-perfected-backend.onrender.com/api/process/JOB_ID
```

### Test 4: Download Result
```bash
curl https://property-perfected-backend.onrender.com/api/download/JOB_ID -o staged.png
```

## 📧 Mailgun Webhook Setup

### Configure Inbound Route
1. Go to Mailgun Dashboard → Receiving → Routes
2. Create new route:
   - **Expression Type**: Match Recipient
   - **Recipient**: `staging@photos.propertyperfected.com`
   - **Actions**: 
     - Forward to URL: `https://property-perfected-backend.onrender.com/api/webhook/mailgun`
     - Store message: Yes (optional)

### Test Email Integration
Send email with property photo to: `staging@photos.propertyperfected.com`

## 🎨 Frontend Deployment (Vercel)

### Option 1: Simple Static Frontend
Already included in `/public/index.html` - served by backend

### Option 2: Next.js Frontend (Future)
1. Create Next.js app
2. Deploy to Vercel
3. Set environment variable: `NEXT_PUBLIC_API_URL=https://property-perfected-backend.onrender.com`
4. Configure custom domain: `app.propertyperfected.com`

## 📊 Monitoring

### Sentry Dashboard
- URL: https://sentry.io/organizations/property-perfected/
- Project: property-perfected-backend
- Check for errors and performance issues

### Render Logs
- View real-time logs in Render dashboard
- Monitor deployment status
- Check resource usage

### Upstash Redis
- Monitor queue length
- Check job processing times
- View Redis metrics

## 🔒 Security Checklist

- [ ] All API keys stored as environment variables (not in code)
- [ ] S3 buckets are private (no public access)
- [ ] Redis access restricted by token
- [ ] CORS configured for frontend domain only
- [ ] Rate limiting enabled (future)
- [ ] Input validation on all endpoints
- [ ] File size limits enforced (10MB)
- [ ] File type validation (images only)

## 🚧 Known Limitations (POC Phase)

- No authentication (Clerk deferred)
- No payment processing (Stripe deferred)
- No image upscaling (Magnific deferred)
- No batch processing (single image only)
- No email delivery (Mailgun outbound deferred)
- Basic error handling
- No retry logic for failed jobs

## 📝 Next Steps (Post-POC)

1. **Add Clerk Authentication**
   - User sign-up/login
   - Protected routes
   - User dashboard

2. **Integrate Magnific Upscaler**
   - Enhance image quality
   - Higher resolution outputs

3. **Implement Stripe Payments**
   - Credit system
   - Subscription plans
   - Usage tracking

4. **Batch Processing**
   - Upload multiple images
   - Process entire property listings
   - Zip file downloads

5. **Email Delivery**
   - Send staged images via Mailgun
   - Professional email templates
   - Delivery confirmations

6. **Advanced AI Models**
   - ControlNet for better geometry
   - SDXL for higher quality
   - Style customization options

## 📞 Support

For issues or questions:
- Email: taylor@propertyperfected.com
- Sentry: Check error logs
- Render: Check deployment logs
