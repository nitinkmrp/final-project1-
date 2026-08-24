import express from 'express';
import mongoose from 'mongoose';
import roleGuard from '../middleware/roleGuard.js';

const router = express.Router();

// Post-processing text sanitizer to strip word counts, meta notes, and conversational filler
const cleanCopyText = (text) => {
  if (!text || typeof text !== 'string') return '';
  return text
    // Remove (Word count: XX), (XX words), Word count: XX, Words: XX, etc.
    .replace(/\(?\b(word\s*count|words?)\s*[:=-]?\s*\d+\s*(words?)?\)?/gi, '')
    // Remove trailing/bracketed notes like [75 words], (approx 80 words)
    .replace(/\[\s*\d+\s*words?\s*\]/gi, '')
    .replace(/\(\s*\d+\s*words?\s*\)/gi, '')
    .replace(/\(\s*approx(imately)?\s*\d+\s*words?\s*\)/gi, '')
    // Remove AI conversational prefixes
    .replace(/^(here\s+(is|are)\s+(a|the)?\s*(product|tagline|description|copy)?[:=-]?\s*)/gi, '')
    .replace(/^(short\s*description|tagline|full\s*description|description|summary)\s*[:=-]\s*/gi, '')
    // Remove wrapping quotes and excessive whitespace
    .replace(/^["'`“”]+|["'`“”]+$/g, '')
    .trim();
};

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

  const systemInstructionText = 'You are an expert e-commerce copywriter. Write highly engaging, conversion-optimized copy. NEVER include word counts, character counts, commentary, headers, or explanations in parentheses. Return ONLY direct customer-facing copy.';

  const tryGenerate = async (modelName, useJson) => {
    const cleanModel = modelName.replace(/^models\//, '');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent?key=${apiKey}`;

    const generationConfig = {
      temperature: 0.6,
      maxOutputTokens: 400,
    };

    if (useJson) {
      generationConfig.responseMimeType = 'application/json';
      generationConfig.responseSchema = {
        type: 'OBJECT',
        properties: {
          short: { type: 'STRING', description: 'Punchy one-line tagline' },
          full: { type: 'STRING', description: 'Engaging product description' }
        },
        required: ['short', 'full']
      };
    }

    const payload = {
      contents: [
        {
          parts: [{ text: prompt }]
        }
      ],
      systemInstruction: {
        parts: [{ text: systemInstructionText }]
      },
      generationConfig
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

      // If schema/JSON mode caused an error on older models, retry without schema
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
          messages: [
            {
              role: 'system',
              content: 'You are an expert e-commerce copywriter. Write clean, conversion-focused copy. Never output word counts, notes, or meta commentary.'
            },
            { role: 'user', content: prompt }
          ],
          temperature: 0.6,
          max_tokens: 350
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
export const generateAICopy = async (prompt, isJson = false) => {
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
  const openRouterKey = process.env.OPENROUTER_API_KEY || '';

  if (geminiKey) {
    return await callGeminiAPI(prompt, geminiKey, isJson);
  }

  if (openRouterKey) {
    if (openRouterKey.startsWith('AIzaSy') || openRouterKey.startsWith('AIza')) {
      return await callGeminiAPI(prompt, openRouterKey, isJson);
    }
    return await callOpenRouterAPI(prompt, openRouterKey);
  }

  throw new Error('MISSING_API_KEY');
};

// POST /api/ai/describe
// Body: { productName, category, price, target, tone }
// target: "both" | "short" | "full"
// tone: "engaging" | "luxury" | "catchy" | "technical"
router.post('/describe', roleGuard(['admin', 'editor']), async (req, res) => {
  const { productName, category, price, target = 'both', tone = 'engaging' } = req.body;

  if (!productName?.trim()) {
    return res.status(400).json({ success: false, message: 'productName is required' });
  }

  const productInfo = [
    `Product: ${productName.trim()}`,
    category ? `Category: ${category.trim()}` : '',
    price    ? `Price: ₹${price}`             : '',
  ].filter(Boolean).join(', ');

  const toneInstructions = {
    luxury: 'Tone: Elegant, sophisticated, and premium luxury voice emphasizing craftsmanship.',
    catchy: 'Tone: Energetic, trendy, bold, and high-energy marketing style.',
    technical: 'Tone: Informative, highlighting build quality, specs, utility, and reliability.',
    engaging: 'Tone: Warm, persuasive, customer-centric, and benefit-focused.'
  };

  const selectedTone = toneInstructions[tone] || toneInstructions.engaging;

  const isJson = target === 'both';
  const prompt =
    target === 'short'
      ? `Write one punchy, catchy marketing tagline for an e-commerce store selling: ${productInfo}.
${selectedTone}
Rules:
- Keep it to 1 strong sentence.
- Do NOT include quotes, word counts, or character numbers.
- Return ONLY the clean tagline text.`
      : target === 'full'
      ? `Write a compelling e-commerce product description for: ${productInfo}.
${selectedTone}
Rules:
- 3 to 4 engaging sentences highlighting quality, benefits, and everyday appeal.
- Include a persuasive call to action.
- Do NOT include headers, bullet points, word counts, or meta notes.
- Return ONLY the final description text.`
      : `Generate e-commerce product copy for: ${productInfo}.
${selectedTone}
Return a JSON object with two fields:
{
  "short": "A punchy, catchy one-line tagline without quotes or word counts",
  "full": "A 3-4 sentence engaging product description highlighting benefits and a call to action without meta commentary"
}
Output strictly valid JSON only.`;

  try {
    const rawText = await generateAICopy(prompt, isJson);

    if (target === 'both') {
      try {
        const clean = rawText.replace(/```json|```/gi, '').trim();
        const parsed = JSON.parse(clean);
        return res.json({
          success: true,
          short: cleanCopyText(parsed.short || ''),
          full: cleanCopyText(parsed.full || rawText)
        });
      } catch {
        // Fallback if parsing fails
        const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
        return res.json({
          success: true,
          short: cleanCopyText(lines[0] || ''),
          full: cleanCopyText(rawText)
        });
      }
    }

    if (target === 'short') {
      return res.json({ success: true, short: cleanCopyText(rawText), full: '' });
    }

    return res.json({ success: true, short: '', full: cleanCopyText(rawText) });

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

// POST /api/ai/refine
// Interactive copy refinement with custom user prompt/feedback
// Body: { productName, category, price, currentShort, currentFull, instructions, tone }
router.post('/refine', roleGuard(['admin', 'editor']), async (req, res) => {
  const {
    productName,
    category,
    price,
    currentShort = '',
    currentFull = '',
    instructions = '',
    tone = 'engaging'
  } = req.body;

  if (!productName?.trim()) {
    return res.status(400).json({ success: false, message: 'productName is required' });
  }

  const productInfo = [
    `Product: ${productName.trim()}`,
    category ? `Category: ${category.trim()}` : '',
    price    ? `Price: ₹${price}`             : '',
  ].filter(Boolean).join(', ');

  const prompt = `You are an expert e-commerce copywriter interactively refining product marketing copy.

PRODUCT CONTEXT:
${productInfo}

CURRENT DRAFT:
- Short Tagline: "${currentShort}"
- Full Description: "${currentFull}"

USER REFINEMENT INSTRUCTIONS / FEEDBACK:
"${instructions.trim() || 'Improve the copy to make it more persuasive, engaging, and conversion-focused.'}"

TASK:
Refine and rewrite the copy incorporating the user's specific instructions.
Return a valid JSON object matching this schema:
{
  "short": "Refined punchy one-line tagline without quotes or word counts",
  "full": "Refined engaging product description matching the user's instructions without meta commentary"
}
Output strictly valid JSON only.`;

  try {
    const rawText = await generateAICopy(prompt, true);
    let parsed = { short: '', full: '' };
    try {
      const clean = rawText.replace(/```json|```/gi, '').trim();
      parsed = JSON.parse(clean);
    } catch {
      parsed = { short: currentShort, full: rawText };
    }

    return res.json({
      success: true,
      short: cleanCopyText(parsed.short || currentShort),
      full: cleanCopyText(parsed.full || rawText)
    });
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

// POST /api/ai/generate-prompt
// Body: { productName, category }
router.post('/generate-prompt', roleGuard(['admin', 'editor']), async (req, res) => {
  const { productName, category } = req.body;

  if (!productName?.trim()) {
    return res.status(400).json({ success: false, message: 'productName is required' });
  }

  const productInfo = `${productName} ${category ? `(Category: ${category})` : ''}`;
  const promptText = `Create a commercial studio photography prompt for AI image generation of: ${productInfo}. 
The image must depict high-end product photography on a clean luxury backdrop with crisp studio lighting and 4K clarity. 
Return ONLY the prompt text. No quotes, no word count notes.`;

  try {
    const generatedPrompt = await generateAICopy(promptText, false);
    return res.json({ success: true, prompt: cleanCopyText(generatedPrompt) });
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

// POST /api/ai/chat
// Customer shopping assistant & stylist chatbot
// Body: { message, history }
router.post('/chat', async (req, res) => {
  const { message, history = [] } = req.body;

  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ success: false, message: 'Message is required' });
  }

  try {
    // 1. Fetch available in-stock products from DB for catalog grounding
    let catalogContext = '';
    const productsMap = {};
    try {
      const Product = mongoose.models.Product;
      if (Product) {
        const products = await Product.find({ stock: { $gt: 0 } })
          .select('_id productName category price discount imgUrl shortDesc sizes avgRating')
          .limit(30)
          .lean();

        if (products && products.length > 0) {
          catalogContext = products.map(p => 
            `[ID: ${p._id}] Name: ${p.productName} | Category: ${p.category} | Price: ₹${p.price} | Discount: ${p.discount || 0}% | Sizes: ${(p.sizes || []).join(', ')} | Summary: ${p.shortDesc || ''}`
          ).join('\n');

          products.forEach(p => {
            productsMap[String(p._id)] = p;
          });
        }
      }
    } catch (e) {
      console.warn('[AI Chat] Could not load product catalog from DB:', e.message);
    }

    // 2. Build conversational system prompt
    const chatPrompt = `You are "Nilex AI", the friendly, stylish, voice-enabled personal shopping assistant for NilexCart (an Indian fashion & lifestyle e-commerce store).

CURRENT STORE IN-STOCK CATALOG:
${catalogContext || 'Catalog loading.'}

STORE POLICIES & INFO:
- Free delivery across India on orders over ₹499. Standard delivery time is 3 to 5 business days.
- 7-day hassle-free return and exchange policy.
- Secure payments via Razorpay, UPI (GPay, PhonePe, Paytm), Cards, Net Banking, and Cash on Delivery (COD).

RULES FOR YOUR RESPONSE:
1. Be warm, enthusiastic, helpful, and concise (natural for voice reading aloud).
2. When the customer is looking for products, gifts, or styling ideas:
   - Recommend matching products strictly from the catalog list above.
   - List their exact IDs in the "recommendedProductIds" array (up to 3 items).
3. If the customer asks about shipping, returns, payment, or orders, explain politely and clearly.
4. Keep the text clean without markdown headers, bullet clutter, or emojis overload.

Return ONLY a valid JSON object matching this schema:
{
  "reply": "Your friendly, voice-friendly conversational answer here",
  "recommendedProductIds": ["id1", "id2"],
  "suggestedFollowUps": ["Question 1", "Question 2", "Question 3"]
}`;

    // Combine recent conversation history (last 4 turns)
    const formattedHistory = Array.isArray(history)
      ? history.slice(-4).map(h => `${h.role === 'user' ? 'Customer' : 'Nilex AI'}: ${h.content}`).join('\n')
      : '';

    const fullUserPrompt = `${formattedHistory ? `Recent Conversation:\n${formattedHistory}\n\n` : ''}Customer says: "${message.trim()}"`;

    const rawResponse = await generateAICopy(
      `${chatPrompt}\n\n${fullUserPrompt}`,
      true
    );

    let parsed = { reply: '', recommendedProductIds: [], suggestedFollowUps: [] };
    try {
      const clean = rawResponse.replace(/```json|```/gi, '').trim();
      parsed = JSON.parse(clean);
    } catch {
      parsed.reply = rawResponse;
    }

    // Hydrate recommended products
    const recommendedProducts = (parsed.recommendedProductIds || [])
      .map(id => productsMap[String(id)])
      .filter(Boolean);

    return res.json({
      success: true,
      reply: cleanCopyText(parsed.reply || 'Here are some great options from our collection!'),
      recommendedProducts,
      suggestedFollowUps: (parsed.suggestedFollowUps || []).slice(0, 3)
    });

  } catch (err) {
    if (err.message === 'MISSING_API_KEY') {
      return res.status(503).json({
        success: false,
        message: 'AI Shopping Assistant is currently offline. Please configure GEMINI_API_KEY on the backend.'
      });
    }
    return res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
