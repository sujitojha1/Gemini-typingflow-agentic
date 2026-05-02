export const GENERATE_IMAGE_SCHEMA = {
  name: 'generate_image',
  description: 'Generates an image for a given text prompt and returns it as a base64 data URI.',
  parameters: {
    type: 'OBJECT',
    properties: {
      prompt: { type: 'STRING', description: 'The visual prompt for the image.' }
    },
    required: ['prompt']
  }
};

export async function generate_image({ prompt }) {
  try {
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=400&height=400&nologo=true`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    const blob = await res.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve({ image_base64: reader.result });
      reader.onerror = () => resolve({ error: 'Failed to read image blob' });
      reader.readAsDataURL(blob);
    });
  } catch (err) {
    return { error: 'Failed to generate image: ' + err.message };
  }
}
