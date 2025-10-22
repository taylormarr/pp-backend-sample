const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';

async function testPipeline(imagePath) {
  try {
    console.log('🧪 Testing Property Perfected Pipeline\n');
    
    // Step 1: Upload image
    console.log('📤 Step 1: Uploading image...');
    const formData = new FormData();
    formData.append('image', fs.createReadStream(imagePath));
    formData.append('email', 'test@propertyperfected.com');
    
    const uploadResponse = await axios.post(`${BACKEND_URL}/api/upload`, formData, {
      headers: formData.getHeaders(),
    });
    
    console.log('✅ Upload successful!');
    console.log('   Job ID:', uploadResponse.data.jobId);
    console.log('   S3 Key:', uploadResponse.data.s3Key);
    
    const jobId = uploadResponse.data.jobId;
    
    // Step 2: Process the job
    console.log('\n🎨 Step 2: Processing staging job...');
    console.log('   (This may take 30-60 seconds for OpenAI DALL-E)');
    
    const processResponse = await axios.post(`${BACKEND_URL}/api/process/${jobId}`);
    
    console.log('✅ Processing complete!');
    console.log('   Status:', processResponse.data.status);
    console.log('   Original:', processResponse.data.originalImage);
    console.log('   Staged:', processResponse.data.stagedImage);
    console.log('   Download URL:', processResponse.data.downloadUrl);
    
    // Step 3: Check job status
    console.log('\n📊 Step 3: Checking job status...');
    const statusResponse = await axios.get(`${BACKEND_URL}/api/job/${jobId}`);
    
    console.log('✅ Job status retrieved!');
    console.log('   Status:', statusResponse.data.status);
    console.log('   Created:', statusResponse.data.createdAt);
    console.log('   Completed:', statusResponse.data.completedAt);
    
    // Step 4: Download staged image
    console.log('\n⬇️  Step 4: Downloading staged image...');
    const downloadResponse = await axios.get(`${BACKEND_URL}/api/download/${jobId}`, {
      responseType: 'arraybuffer',
    });
    
    const outputPath = path.join(__dirname, `staged-${Date.now()}.png`);
    fs.writeFileSync(outputPath, downloadResponse.data);
    
    console.log('✅ Download complete!');
    console.log('   Saved to:', outputPath);
    
    console.log('\n🎉 Pipeline test completed successfully!\n');
    
    return {
      jobId,
      outputPath,
      success: true,
    };
    
  } catch (error) {
    console.error('\n❌ Pipeline test failed!');
    console.error('Error:', error.response?.data || error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

// Run test if called directly
if (require.main === module) {
  const imagePath = process.argv[2];
  
  if (!imagePath) {
    console.error('Usage: node test-client.js <path-to-image>');
    process.exit(1);
  }
  
  if (!fs.existsSync(imagePath)) {
    console.error('Error: Image file not found:', imagePath);
    process.exit(1);
  }
  
  testPipeline(imagePath)
    .then(result => {
      process.exit(result.success ? 0 : 1);
    })
    .catch(error => {
      console.error('Unexpected error:', error);
      process.exit(1);
    });
}

module.exports = { testPipeline };
