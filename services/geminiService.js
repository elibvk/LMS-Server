// server/services/geminiService.js
const axios = require("axios");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODEL_NAME = "gemini-2.5-flash";

// Cooldown to prevent 429
let lastCallTime = 0;
const COOLDOWN_MS = 60 * 1000; // 1 minute

async function generateQuiz(courseTitle, readmeContent, difficulty = null) {
  console.log("📝 Starting quiz generation...");

  const now = Date.now();
  if (now - lastCallTime < COOLDOWN_MS) {
    return {
      success: false,
      error: "Quiz generation is cooling down. Please wait a minute.",
      retryAfter: 60
    };
  }

  lastCallTime = now;

  try {
    if (!difficulty) {
      const levels = ["easy", "medium", "hard"];
      difficulty = levels[Math.floor(Math.random() * levels.length)];
    }

    const sanitizedContent = readmeContent
      .replace(/\s+/g, " ")
      .trim()
      .substring(0, 8000);

    const prompt = `
You are an educational quiz generator.

Topic: "${courseTitle}"
Difficulty: ${difficulty}

Content:
${sanitizedContent}

Generate ONE MCQ.
Return ONLY valid JSON:

{
  "question": "",
  "options": ["", "", "", ""],
  "correctAnswer": 0,
  "difficulty": "${difficulty}",
  "explanation": ""
}
`;

    console.log(`🔄 Calling Gemini model: ${MODEL_NAME}`);

    const url = `https://generativelanguage.googleapis.com/v1/models/${MODEL_NAME}:generateContent?key=${GEMINI_API_KEY}`;

    const response = await axios.post(
      url,
      {
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 800
        }
      },
      { timeout: 30000 }
    );

    let text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      throw new Error("Empty response from Gemini");
    }

    text = text.replace(/```json|```/g, "").trim();
    text = text.replace(/^[^{]*/, "").replace(/[^}]*$/, "");

    const quiz = JSON.parse(text);

    if (!quiz.question || !Array.isArray(quiz.options)) {
      throw new Error("Invalid quiz structure");
    }

    console.log("✅ Quiz generated successfully");

    return {
      success: true,
      quiz
    };

  } catch (error) {
    if (error.response?.status === 429) {
      return {
        success: false,
        error: "AI is busy. Please try again in a minute.",
        retryAfter: 60
      };
    }

    console.error("❌ Gemini REST Error:", error.message);

    return {
      success: false,
      error: "Quiz generation failed",
      fallback: true
    };
  }
}

module.exports = { generateQuiz };