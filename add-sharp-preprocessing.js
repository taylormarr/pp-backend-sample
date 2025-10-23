// Add this at the top with other imports:
const sharp = require('sharp');

// Add this function before processImageAsync:
async function preprocessImageForOpenAI(imageBuffer) {
  // Convert to PNG and resize to 1024x1024 (square, as required by OpenAI)
  const processedBuffer = await sharp(imageBuffer)
    .resize(1024, 1024, {
      fit: 'cover',  // Crop to fill the square
      position: 'center'
    })
    .png()
    .toBuffer();
  
  return processedBuffer;
}

// Then in processImageAsync, after getting imageBuffer from S3:
const imageBuffer = Buffer.concat(chunks);

// Add preprocessing:
console.log(`🖼️  Preprocessing image for OpenAI (converting to 1024x1024 PNG)`);
const processedImageBuffer = await preprocessImageForOpenAI(imageBuffer);

// Then use processedImageBuffer instead of imageBuffer when calling OpenAI:
image: new File([processedImageBuffer], "image.png", { type: "image/png" }),
