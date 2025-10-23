const sharp = require('sharp');

async function testMask() {
  console.log("Creating white mask...");
  
  const maskBuffer = await sharp({
    create: {
      width: 1024,
      height: 1024,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 }
    }
  }).png().toBuffer();
  
  console.log("Mask created, size:", maskBuffer.length, "bytes");
  
  // Save it to verify
  await sharp(maskBuffer).toFile('test-mask.png');
  console.log("Mask saved to test-mask.png");
}

testMask().catch(console.error);
