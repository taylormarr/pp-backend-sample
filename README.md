# Property Perfected - Backend API

AI-powered real estate staging platform backend.

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ or Bun
- AWS S3 buckets configured
- OpenAI API access
- Upstash Redis instance
- Sentry account (optional)

### Installation

```bash
bun install
# or
npm install
```

### Environment Variables

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

### Run Locally

```bash
bun run dev
# or
npm run dev
```

Server will start on `http://localhost:3000`

## 📡 API Endpoints

### Health Check
```
GET /
GET /health
```

Returns server status and connected services.

### Upload Image
```
POST /api/upload
Content-Type: multipart/form-data

Body:
- image: File (required)
- email: String (optional)
```

**Response:**
```json
{
  "success": true,
  "jobId": "job-1234567890",
  "message": "Image uploaded and queued for staging",
  "s3Key": "uploads/1234567890-image.jpg"
}
```

### Process Staging Job
```
POST /api/process/:jobId
```

Processes the uploaded image and generates a staged version using OpenAI DALL-E.

**Response:**
```json
{
  "success": true,
  "jobId": "job-1234567890",
  "status": "completed",
  "originalImage": "uploads/1234567890-image.jpg",
  "stagedImage": "outputs/staged-1234567890-image.jpg",
  "downloadUrl": "https://backend-url/api/download/job-1234567890"
}
```

### Get Job Status
```
GET /api/job/:jobId
```

**Response:**
```json
{
  "jobId": "job-1234567890",
  "s3Key": "uploads/1234567890-image.jpg",
  "fileName": "1234567890-image.jpg",
  "userEmail": "user@example.com",
  "status": "completed",
  "outputS3Key": "outputs/staged-1234567890-image.jpg",
  "createdAt": "2025-10-21T20:00:00.000Z",
  "completedAt": "2025-10-21T20:01:30.000Z"
}
```

### Download Staged Image
```
GET /api/download/:jobId
```

Downloads the staged image file.

### Mailgun Webhook (Email Integration)
```
POST /api/webhook/mailgun
Content-Type: multipart/form-data
```

Receives inbound emails with property photos and automatically queues them for staging.

## 🔄 Complete Workflow

1. **Upload** → Image sent to `/api/upload`
2. **Store** → Original saved to S3 uploads bucket
3. **Queue** → Job added to Redis queue
4. **Process** → Call `/api/process/:jobId` to trigger staging
5. **AI Stage** → OpenAI DALL-E generates staged image
6. **Save** → Staged image saved to S3 outputs bucket
7. **Download** → User retrieves via `/api/download/:jobId`

## 🧪 Testing the Pipeline

### Using cURL

```bash
# 1. Upload an image
curl -X POST http://localhost:3000/api/upload \
  -F "image=@/path/to/room.jpg" \
  -F "email=test@example.com"

# Response: {"success":true,"jobId":"job-1234567890",...}

# 2. Process the job
curl -X POST http://localhost:3000/api/process/job-1234567890

# 3. Check status
curl http://localhost:3000/api/job/job-1234567890

# 4. Download result
curl http://localhost:3000/api/download/job-1234567890 -o staged-image.png
```

## 🏗️ Architecture

```
┌─────────────┐
│   Client    │
│ (Web/Email) │
└──────┬──────┘
       │
       ▼
┌─────────────────┐
│  Render Backend │
│   (Express.js)  │
└────┬───┬───┬────┘
     │   │   │
     ▼   ▼   ▼
┌────┐ ┌────┐ ┌────────┐
│ S3 │ │Redis│ │ OpenAI │
└────┘ └────┘ └────────┘
```

## 📦 Deployment

### Render

1. Connect GitHub repository
2. Set environment variables in Render dashboard
3. Deploy automatically on push to main

### Environment Variables (Render)

All variables from `.env.example` must be set in Render's environment settings.

## 🔐 Security

- All API keys stored as environment variables
- S3 buckets are private (IAM-restricted)
- Redis access token-protected
- Sentry for error monitoring
- CORS enabled for frontend integration

## 📊 Monitoring

Errors and performance tracked via Sentry:
- Organization: Property Perfected
- Project: property-perfected-backend
- Platform: Node.js (Express)

## 🚧 Future Enhancements

- [ ] Clerk authentication
- [ ] Magnific upscaler integration
- [ ] Batch processing for multiple images
- [ ] Stripe payment integration
- [ ] Email delivery via Mailgun (outbound)
- [ ] ControlNet/SDXL for better staging quality

## 📝 License

Proprietary - Property Perfected © 2025
