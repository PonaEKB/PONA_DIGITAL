import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { messages } = req.body || {};
  if (!Array.isArray(messages)) {
    res.status(400).json({ error: 'messages array required' });
    return;
  }

  const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n') || undefined;
  const conversation = messages.filter(m => m.role === 'user' || m.role === 'assistant');

  try {
    const response = await client.messages.create({
      model: 'claude-opus-5',
      max_tokens: 4096,
      system,
      messages: conversation
    });
    const textBlock = response.content.find(b => b.type === 'text');
    res.status(200).json({ choices: [{ message: { content: textBlock ? textBlock.text : '' } }] });
  } catch (err) {
    res.status(err.status || 500).json({ error: { message: err.message } });
  }
}
