// server/services/chatgptService.js
const axios = require('axios');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-3.5-turbo';

// Rate limiting
let lastCallTime = 0;
const COOLDOWN_MS = 5000; // 5 seconds between calls

/**
 * Generate a quiz question using ChatGPT
 * @param {string} content - The content to generate question from
 * @param {string} difficulty - easy | medium | hard
 * @returns {Promise<Object>} Generated question
 */
async function generateQuestionWithChatGPT(content, difficulty = 'medium') {
  console.log('🤖 Starting ChatGPT question generation...');

  // Rate limiting
  const now = Date.now();
  if (now - lastCallTime < COOLDOWN_MS) {
    const waitTime = Math.ceil((COOLDOWN_MS - (now - lastCallTime)) / 1000);
    return {
      success: false,
      error: `Please wait ${waitTime} seconds before generating another question`,
      retryAfter: waitTime
    };
  }

  lastCallTime = now;

  try {
    // Validate API key
    if (!OPENAI_API_KEY) {
      throw new Error('OpenAI API key not configured');
    }

    // Sanitize content (limit to 6000 chars)
    const sanitizedContent = content
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 6000);

    if (sanitizedContent.length < 50) {
      return {
        success: false,
        error: 'Content is too short. Please provide at least 50 characters.'
      };
    }

    // Construct prompt
    const prompt = `You are an expert educational quiz generator.

Generate ONE multiple-choice question based on the following content.

Content:
${sanitizedContent}

Requirements:
- Difficulty: ${difficulty}
- Create 4 clear options (A, B, C, D)
- Only ONE option should be correct
- Provide a brief explanation (2-3 sentences) for the correct answer
- Make the question test understanding, not just memorization

Return ONLY valid JSON in this exact format (no markdown, no code blocks):
{
  "question": "Your question here?",
  "options": ["Option A", "Option B", "Option C", "Option D"],
  "correctAnswer": 0,
  "explanation": "Brief explanation why this is correct."
}

The correctAnswer should be the index (0-3) of the correct option in the options array.`;

    console.log(`📤 Calling ChatGPT API (model: ${OPENAI_MODEL})...`);

    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: OPENAI_MODEL,
        messages: [
          {
            role: 'system',
            content: 'You are an expert educational quiz generator. Always respond with valid JSON only.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 500
      },
      {
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    let responseText = response.data.choices[0].message.content.trim();
    console.log('📥 Received ChatGPT response');

    // Clean response (remove markdown if present)
    responseText = responseText.replace(/```json\n?/g, '');
    responseText = responseText.replace(/```\n?/g, '');
    responseText = responseText.replace(/^[^{]*/, ''); // Remove text before {
    responseText = responseText.replace(/[^}]*$/, ''); // Remove text after }

    // Parse JSON
    const quiz = JSON.parse(responseText);

    // Validate structure
    if (!quiz.question || !Array.isArray(quiz.options) || quiz.options.length !== 4) {
      throw new Error('Invalid question structure from ChatGPT');
    }

    if (typeof quiz.correctAnswer !== 'number' || quiz.correctAnswer < 0 || quiz.correctAnswer > 3) {
      throw new Error('Invalid correctAnswer index');
    }

    if (!quiz.explanation) {
      throw new Error('Missing explanation');
    }

    console.log('✅ Question generated successfully');

    return {
      success: true,
      question: {
        question: quiz.question,
        options: quiz.options,
        correctAnswer: quiz.correctAnswer,
        difficulty: difficulty,
        explanation: quiz.explanation
      }
    };

  } catch (error) {
    console.error('❌ ChatGPT API Error:', error.message);

    // Handle specific errors
    if (error.response) {
      const status = error.response.status;
      
      if (status === 401) {
        return {
          success: false,
          error: 'Invalid OpenAI API key. Please check your configuration.'
        };
      }
      
      if (status === 429) {
        return {
          success: false,
          error: 'ChatGPT API rate limit reached. Please try again in a minute.',
          retryAfter: 60
        };
      }
      
      if (status === 500) {
        return {
          success: false,
          error: 'ChatGPT service temporarily unavailable. Please try again.'
        };
      }
    }

    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      return {
        success: false,
        error: 'Request timeout. Please try again.'
      };
    }

    return {
      success: false,
      error: error.message || 'Failed to generate question'
    };
  }
}

/**
 * Test API key validity
 * @returns {Promise<Object>} Test result
 */
async function testAPIKey() {
  try {
    if (!OPENAI_API_KEY) {
      return { valid: false, error: 'API key not configured' };
    }

    const response = await axios.get('https://api.openai.com/v1/models', {
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      timeout: 10000
    });

    const models = response.data.data.map(m => m.id);
    const hasGPT = models.some(m => m.includes('gpt'));

    return {
      valid: true,
      models: models.filter(m => m.includes('gpt')),
      currentModel: OPENAI_MODEL,
      modelAvailable: models.includes(OPENAI_MODEL)
    };
  } catch (error) {
    return {
      valid: false,
      error: error.response?.data?.error?.message || error.message
    };
  }
}

module.exports = {
  generateQuestionWithChatGPT,
  testAPIKey
};