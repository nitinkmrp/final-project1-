import express from 'express';
import roleGuard from '../middleware/roleGuard.js';

const router = express.Router();

// Helper to call Google Gemini API directly with dynamic model discovery & fallback
const callGeminiAPI = async (prompt, apiKey, isJson = false) => {
  const candidateModels = [
    'gemini-1.5-flash',
    'gemini-1.5-flash-latest',
    'gemini-2.0-flash',
    'gemini-2.0-flash-exp',
    'gemini-2.5-flash',
    'gemini-1.5-pro',
    'gemini-1.5-pro-latest',
    'gemini-pro'
  ];

  const tryGenerate = async (modelName, useJson) => {
    const cleanModel = modelName.replace(/^models\//, '');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent?key=${apiKey}`;

    const payload = {
      contents: [
        {
          parts: [{ text: prompt }]
        }
      ],
      generationConfig: {
        temperature: 0.7,
        ...(useJson ? { responseMimeType: 'application/json' } : {})
      }
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    return { ok: res.ok, status: res.status, data };
  };

  // 1. Try preferred candidate models
  for (const model of candidateModels) {
    try {
      const result = await tryGenerate(model, isJson);
      if (result.ok) {
        const text = result.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (text) return text;
      }

      // Check for permission or quota issues that shouldn't be retried
      const errMsg = result.data?.error?.message || '';
      const errStatus = result.data?.error?.status || '';
      if (errStatus === 'PERMISSION_DENIED' || errMsg.includes('API key not valid') || errStatus === 'RESOURCE_EXHAUSTED') {
        throw new Error(errMsg || 'Google Gemini API key permission denied or quota exhausted.');
      }

      // If JSON mode caused error, retry this model with plain text
      if (isJson) {
        const retryResult = await tryGenerate(model, false);
        if (retryResult.ok) {
          const text = retryResult.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
          if (text) return text;
        }
      }
    } catch (err) {
      if (err.message.includes('API key not valid') || err.message.includes('permission denied') || err.message.includes('quota')) {
        throw err;
      }
    }
  }

  // 2. If candidate models failed, query ModelService.ListModels to see what models this key supports
  try {
    const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    const listRes = await fetch(listUrl);
    const listData = await listRes.json();

    if (listRes.ok && Array.isArray(listData?.models)) {
      const supportedModels = listData.models
        .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
        .map(m => m.name);

      console.log('[Gemini API] Available models for this key:', supportedModels);

      for (const modelName of supportedModels) {
        const result = await tryGenerate(modelName, false);
        if (result.ok) {
          const text = result.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
          if (text) return text;
        }
      }
    } else if (listData?.error?.message) {
      throw new Error(listData.error.message);
    }
  } catch (err) {
    if (err.message && !err.message.includes('fetch')) {
      throw err;
    }
  }

  throw new Error('Google Gemini API was unable to process the request. Please verify your GEMINI_API_KEY in Google AI Studio.');
};

// Helper to call OpenRouter API
const callOpenRouterAPI = async (prompt, apiKey) => {
  const url = 'https://openrouter.ai/api/v1/chat/completions';
  const models = ['google/gemini-2.0-flash-001', 'google/gemini-flash-1.5', 'openai/gpt-4o-mini', 'meta-llama/llama-3.3-70b-instruct:free'];
  let lastError = null;

  for (const model of models) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://nilex.in',
          'X-Title': 'NilexCart Admin'
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.7
        })
      });

      const data = await res.json();
      if (!res.ok) {
        lastError = new Error(data?.error?.message || `OpenRouter API error (${res.status})`);
        continue;
      }

      const text = data?.choices?.[0]?.message?.content?.trim();
      if (text) return text;
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error('Failed to generate response from OpenRouter');
};

// Unified dispatcher: determines whether to call Google Gemini or OpenRouter
const generateAICopy = async (prompt, isJson = false) => {
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
  const openRouterKey = process.env.OPENROUTER_API_KEY || '';

  // 1. If key starts with AIzaSy (standard Google API key format) or GEMINI_API_KEY is provided
  if (geminiKey) {
    return await callGeminiAPI(prompt, geminiKey, isJson);
  }

  // 2. If OPENROUTER_API_KEY is provided: check if it's accidentally a Google key or actual OpenRouter key
  if (openRouterKey) {
    if (openRouterKey.startsWith('AIzaSy') || openRouterKey.startsWith('AIza')) {
      // User entered Google Gemini key into OPENROUTER_API_KEY variable
      return await callGeminiAPI(prompt, openRouterKey, isJson);
    }
    return await callOpenRouterAPI(prompt, openRouterKey);
  }

  throw new Error('MISSING_API_KEY');
};

// POST /api/ai/describe
// Body: { productName, category, price, target }
// target: "both" | "short" | "full"
router.post('/describe', roleGuard(['admin', 'editor']), async (req, res) => {
  const { productName, category, price, target = 'both' } = req.body;

  if (!productName?.trim()) {
    return res.status(400).json({ success: false, message: 'productName is required' });
  }

  const productInfo = [
    `Product: ${productName.trim()}`,
    category ? `Category: ${category.trim()}` : '',
    price    ? `Price: ₹${price}`             : '',
  ].filter(Boolean).join(', ');

  const isJson = target === 'both';
  const prompt =
    target === 'short'
      ? `Write a concise, punchy one-line marketing tagline (maximum 15 words) for: ${productInfo}. Return only the tagline without surrounding quotes.`
      : target === 'full'
      ? `Write a compelling full product description (3–4 sentences, ~80 words) for an e-commerce website for: ${productInfo}. Include key features, benefits, and an engaging call to action. Return only the description text.`
      : `Generate product marketing copy for an e-commerce website for: ${productInfo}.
Return a JSON object with exactly two keys:
- "short": A catchy one-line marketing tagline (maximum 15 words)
- "full": A compelling product description in 3–4 sentences (~80 words) highlighting features, materials, and benefits.
Return ONLY valid JSON matching this structure: {"short": "...", "full": "..."}`;

  try {
    const rawText = await generateAICopy(prompt, isJson);

    if (target === 'both') {
      try {
        const clean = rawText.replace(/```json|```/gi, '').trim();
        const parsed = JSON.parse(clean);
        return res.json({
          success: true,
          short: parsed.short || '',
          full: parsed.full || rawText
        });
      } catch {
        // Fallback if parsing fails
        return res.json({
          success: true,
          short: rawText.split('\n')[0] || '',
          full: rawText
        });
      }
    }

    if (target === 'short') {
      const clean = rawText.replace(/^["']|["']$/g, '').trim();
      return res.json({ success: true, short: clean, full: '' });
    }

    return res.json({ success: true, short: '', full: rawText });

  } catch (err) {
    if (err.message === 'MISSING_API_KEY') {
      return res.status(503).json({
        success: false,
        message: 'Gemini API key is not configured. Please add GEMINI_API_KEY to your backend .env file (or Render dashboard).'
      });
    }
    return res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/ai/generate-prompt
// Body: { productName, category }
router.post('/generate-prompt', roleGuard(['admin', 'editor']), async (req, res) => {
  const { productName, category } = req.body;

  if (!productName?.trim()) {
    return res.status(400).json({ success: false, message: 'productName is required' });
  }

  const productInfo = `${productName} ${category ? `(Category: ${category})` : ''}`;
  const promptText = `Create a highly detailed, descriptive photography prompt for AI image generation of an e-commerce product: ${productInfo}. 
The image should be a professional commercial product studio shot, clean white or luxury aesthetic background, 4k resolution, hyper-realistic, studio lighting. 
Return ONLY the prompt text, no quotes or markdown. Maximum 50 words.`;

  try {
    const generatedPrompt = await generateAICopy(promptText, false);
    const cleanPrompt = generatedPrompt.replace(/^["']|["']$/g, '').trim();
    return res.json({ success: true, prompt: cleanPrompt });
  } catch (err) {
    if (err.message === 'MISSING_API_KEY') {
      return res.status(503).json({
        success: false,
        message: 'Gemini API key is not configured. Please add GEMINI_API_KEY to your backend .env file.'
      });
    }
    return res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
