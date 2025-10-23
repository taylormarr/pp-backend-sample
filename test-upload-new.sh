#!/bin/bash
echo "Testing fresh upload..."

# Upload
RESPONSE=$(curl -X POST https://property-perfected-backend.onrender.com/api/upload \
  -F "image=@test-room.png" \
  -F "email=taylor@propertyperfected.com" \
  2>/dev/null)

JOBID=$(echo $RESPONSE | jq -r '.jobId')
echo "Job ID: $JOBID"

# Start processing
curl -X POST https://property-perfected-backend.onrender.com/api/process/$JOBID 2>/dev/null | jq .

# Check status immediately
echo "Status after 5 seconds:"
sleep 5
curl -s https://property-perfected-backend.onrender.com/api/job/$JOBID | jq .
