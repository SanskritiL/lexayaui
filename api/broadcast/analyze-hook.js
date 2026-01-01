// Analyze Hook API
// Uses Gemini 2.0 Flash to analyze video hook for viral potential
// Stateless - no database, examples included in prompt

const { createClient } = require('@supabase/supabase-js');

// Viral hook examples for RAG-style comparison (included in prompt)
const VIRAL_HOOK_EXAMPLES = `
Here are examples of viral hooks that perform well:

CURIOSITY HOOKS:
- "Nobody is talking about this..." (500K+ avg views) - Creates FOMO and exclusivity
- "The secret that X don't want you to know" (520K avg views) - Insider knowledge appeal
- "Wait for it..." (550K avg views) - Creates anticipation, increases watch time
- "Why is nobody talking about this feature?" (360K avg views) - Questions increase engagement

CONTROVERSY HOOKS:
- "The algorithm doesn't want you to see this" (600K avg views) - Creates urgency and rebellion
- "You've been doing X wrong this whole time" (480K avg views) - Challenges assumptions
- "Unpopular opinion:" (550K avg views) - Highest engagement but can be polarizing

RESULTS HOOKS:
- "I made $X in Y days doing this" (750K avg views) - Specific numbers perform 3x better
- "I can't believe this actually worked" (420K avg views) - Authentic surprise triggers curiosity

TUTORIAL HOOKS:
- "3 things I wish I knew sooner about..." (350K avg views) - Numbered lists set expectations
- "Here's a hack that will save you hours" (440K avg views) - Promise of time savings is powerful
- "I asked ChatGPT to..." (380K avg views) - AI trend hooks still perform well

PATTERN INTERRUPT HOOKS:
- "Stop scrolling if you..." (400K avg views) - Direct command creates pattern interrupt
- "Watch this before you..." (470K avg views) - Warning hooks create urgency

STORY HOOKS:
- "POV: You just discovered..." (300K avg views) - Immerses viewer immediately
- "Day X of trying to..." (380K avg views) - Creates series, builds following
- "What I learned after X years of..." (320K avg views) - Experience-based

MOTIVATION HOOKS:
- "This is your sign to..." (250K avg views) - Personal connection, relatability
- "If you're seeing this, it's meant for you" (290K avg views) - Feels destined
`;

module.exports = async function handler(req, res) {
    console.log('========== ANALYZE HOOK API START ==========');

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
    const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Check for Google API key
    if (!GOOGLE_API_KEY) {
        console.log('[ERROR] GOOGLE_API_KEY not configured');
        return res.status(500).json({ error: 'AI service not configured. Add GOOGLE_API_KEY to environment.' });
    }

    // Verify authentication
    console.log('[AUTH] Verifying authorization...');
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        console.log('[AUTH] No authorization header');
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);

    if (userError || !user) {
        console.log('[AUTH] User verification failed:', userError);
        return res.status(401).json({ error: 'Invalid token' });
    }
    console.log('[AUTH] User verified:', user.id);

    // Parse request
    const { frameBase64 } = req.body;

    if (!frameBase64) {
        return res.status(400).json({ error: 'frameBase64 is required' });
    }

    try {
        // Call Gemini to analyze the frame
        console.log('[GEMINI] Sending frame for analysis...');
        const result = await analyzeWithGemini(frameBase64, GOOGLE_API_KEY);
        console.log('[GEMINI] Analysis complete, score:', result.viral_score);

        console.log('========== ANALYZE HOOK API SUCCESS ==========');

        // Return results
        return res.status(200).json({
            success: true,
            viral_score: result.viral_score,
            extracted_text: result.extracted_text || '',
            analysis: {
                strengths: result.strengths || [],
                weaknesses: result.weaknesses || [],
                visual_analysis: result.visual_analysis || {}
            },
            suggestions: result.suggestions || [],
            similar_hooks: result.similar_hooks || []
        });

    } catch (error) {
        console.error('[ERROR]', error.message);
        console.error('[ERROR] Stack:', error.stack);
        return res.status(500).json({ error: error.message });
    }
};

// Helper: Call Gemini 2.0 Flash Vision API
async function analyzeWithGemini(frameBase64, apiKey) {
    const prompt = `You are a viral content expert. Analyze this video thumbnail/first frame for viral hook potential on social media (TikTok, Instagram Reels, LinkedIn).

${VIRAL_HOOK_EXAMPLES}

Now analyze the provided image and return a JSON response with these exact fields:
{
    "extracted_text": "Any text visible in the image (exact transcription). Empty string if no text.",
    "visual_analysis": {
        "has_face": true/false,
        "face_expression": "description if face present, null otherwise",
        "text_placement": "top/center/bottom/top-left/etc or null",
        "dominant_colors": ["color1", "color2"],
        "composition": "brief description of layout",
        "attention_grabbing_elements": ["element1", "element2"]
    },
    "strengths": ["strength1", "strength2", "strength3"],
    "weaknesses": ["weakness1", "weakness2"],
    "suggestions": ["actionable suggestion 1", "actionable suggestion 2", "actionable suggestion 3"],
    "viral_score": 65,
    "similar_hooks": [
        {"hook_text": "Similar viral hook from examples above", "category": "curiosity", "avg_views": 500000},
        {"hook_text": "Another similar hook", "category": "results", "avg_views": 750000}
    ]
}

SCORING GUIDE (0-100):
- 80-100: Excellent hook - has strong text, face with expression, high contrast, matches proven viral patterns
- 60-79: Good hook - has most elements but could improve in 1-2 areas
- 40-59: Average hook - missing some key viral elements
- 20-39: Weak hook - needs significant improvement
- 0-19: Very weak hook - missing most viral elements

Be specific and actionable in your suggestions. Compare against the viral hook examples provided.
Return ONLY the JSON object, no markdown formatting or explanation.`;

    // Clean base64 string
    const base64Data = frameBase64.replace(/^data:image\/\w+;base64,/, '');

    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [
                        { text: prompt },
                        {
                            inline_data: {
                                mime_type: 'image/jpeg',
                                data: base64Data
                            }
                        }
                    ]
                }],
                generationConfig: {
                    temperature: 0.7,
                    maxOutputTokens: 1500
                }
            })
        }
    );

    if (!response.ok) {
        const errorText = await response.text();
        console.error('[GEMINI] API error:', errorText);
        throw new Error(`Gemini API error: ${response.status}`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Parse JSON from response (Gemini may include markdown)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
        console.error('[GEMINI] Failed to parse response:', text);
        // Return a default analysis if parsing fails
        return {
            extracted_text: '',
            visual_analysis: {
                has_face: false,
                text_placement: 'unknown',
                dominant_colors: [],
                composition: 'Unable to analyze',
                attention_grabbing_elements: []
            },
            strengths: ['Video uploaded successfully'],
            weaknesses: ['Analysis could not be completed - please try again'],
            suggestions: ['Try uploading a clearer frame', 'Ensure good lighting in your hook'],
            viral_score: 50,
            similar_hooks: []
        };
    }

    try {
        const parsed = JSON.parse(jsonMatch[0]);
        // Ensure viral_score is within bounds
        parsed.viral_score = Math.max(0, Math.min(100, parsed.viral_score || 50));
        return parsed;
    } catch (parseError) {
        console.error('[GEMINI] JSON parse error:', parseError);
        return {
            extracted_text: '',
            visual_analysis: {},
            strengths: ['Video uploaded successfully'],
            weaknesses: ['Analysis could not be completed - please try again'],
            suggestions: ['Try uploading a clearer frame'],
            viral_score: 50,
            similar_hooks: []
        };
    }
}
