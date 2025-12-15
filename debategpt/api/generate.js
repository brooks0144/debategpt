// api/generate.js - Vercel Serverless Function
export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Get API key from environment variable (set in Vercel dashboard)
  const apiKey = process.env.OPENAI_API_KEY;
  
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  try {
    const { kind, payload } = req.body;

    let prompt = '';

    if (kind === 'replies') {
      const { tweet_text, tone, angle, length, num_replies, extra_instructions } = payload;
      
      prompt = `You are a tweet reply generator. Generate ONE unique reply to this tweet:

Tweet: "${tweet_text}"

Tone: ${tone}
Angle: ${angle}
Length: ${length}
${extra_instructions ? `Additional instructions: ${extra_instructions}` : ''}

Generate a single engaging reply that:
- Matches the ${tone} tone and ${angle} angle
- Is ${length === 'short' ? 'under 100 chars' : length === 'medium' ? 'under 280 chars' : 'a mini-thread (2-3 tweets)'}
- Feels natural and conversational
- Is distinctly different from other possible replies

Return ONLY the reply text, no extra formatting or explanation.`;

    } else if (kind === 'hooks') {
      const { topic, tone, num_hooks, extra_instructions } = payload;
      
      prompt = `You are a viral tweet hook generator. Generate ONE attention-grabbing hook:

Topic: "${topic}"
Tone: ${tone}
${extra_instructions ? `Additional instructions: ${extra_instructions}` : ''}

Create a single punchy hook that:
- Uses ${tone} tone
- Is under 20 words
- Induces curiosity and engagement
- Is distinctly different from other possible hooks

Return ONLY the hook text, no extra formatting or explanation.`;

    } else {
      return res.status(400).json({ error: 'Invalid kind parameter' });
    }

    // Call OpenAI API
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.9,
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || `OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices[0].message.content.trim().replace(/^["']|["']$/g, '');

    // Return the generated content
    return res.status(200).json({ content });

  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}