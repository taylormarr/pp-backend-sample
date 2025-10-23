// Find the OpenAI processing section and replace it

// After preprocessing the image, create a white mask
const maskBuffer = await sharp({
  create: {
    width: 1024,
    height: 1024,
    channels: 4,
    background: { r: 255, g: 255, b: 255, alpha: 1 }
  }
}).png().toBuffer();

// Then use both image and mask in the API call
const response = await openai.images.edit({
  model: process.env.OPENAI_IMAGE_MODEL || 'dall-e-2',
  image: new File([processedImageBuffer], "image.png", { type: "image/png" }),
  mask: new File([maskBuffer], "mask.png", { type: "image/png" }),
  prompt: 'Transform this empty room into a beautifully staged, professionally furnished space. Add modern furniture, tasteful decor, proper lighting, and create an inviting atmosphere that would appeal to potential home buyers. Maintain the room\'s architecture and structure.',
  n: 1,
  size: '1024x1024',
});
