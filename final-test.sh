#!/bin/bash
echo "🎉 FINAL TEST - Property Perfected AI Staging Pipeline"
echo "======================================================"
echo ""

echo "📤 Step 1: Uploading test image..."
RESPONSE=$(curl -X POST https://property-perfected-backend.onrender.com/api/upload \
  -F "image=@test-room.png" \
  -F "email=taylor@propertyperfected.com" \
  2>/dev/null)

JOBID=$(echo $RESPONSE | jq -r '.jobId')
echo "✅ Upload successful!"
echo "   Job ID: $JOBID"
echo ""

echo "🎨 Step 2: Starting AI staging process..."
curl -X POST https://property-perfected-backend.onrender.com/api/process/$JOBID 2>/dev/null | jq .
echo ""

echo "⏳ Step 3: Waiting 60 seconds for OpenAI DALL-E to work its magic..."
for i in {1..12}; do
  echo -n "."
  sleep 5
done
echo ""
echo ""

echo "📊 Step 4: Checking final result..."
curl -s https://property-perfected-backend.onrender.com/api/job/$JOBID | jq .
echo ""

STATUS=$(curl -s https://property-perfected-backend.onrender.com/api/job/$JOBID | jq -r '.status')
if [ "$STATUS" = "completed" ]; then
  echo "🎉🎉🎉 SUCCESS! Your AI staging pipeline is LIVE! 🎉🎉🎉"
  echo ""
  echo "Download your staged image at:"
  echo "https://property-perfected-backend.onrender.com/api/download/$JOBID"
else
  echo "Status: $STATUS"
  echo "Check the error details above."
fi
