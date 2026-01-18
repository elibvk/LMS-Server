// server/services/geminiService.js
const axios = require("axios");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODEL_NAME = "gemini-pro";

// ✅ FIXED: Per-user cooldown map instead of global
const userCooldowns = new Map();
const COOLDOWN_MS = 10 * 1000; // 10 seconds per user

async function generateQuiz(courseTitle, readmeContent, difficulty = null, userId = 'default') {
  console.log("🔍 Starting quiz generation for user:", userId);

  const now = Date.now();
  const lastCall = userCooldowns.get(userId) || 0;
  
  if (now - lastCall < COOLDOWN_MS) {
    const waitTime = Math.ceil((COOLDOWN_MS - (now - lastCall)) / 1000);
    return {
      success: false,
      error: `Please wait ${waitTime} seconds before generating another question.`,
      retryAfter: waitTime
    };
  }

  userCooldowns.set(userId, now);

  // Clean up old entries (older than 5 minutes)
  for (const [key, time] of userCooldowns.entries()) {
    if (now - time > 5 * 60 * 1000) {
      userCooldowns.delete(key);
    }
  }

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

Generate ONE multiple choice question (MCQ) with 4 options.
Return ONLY valid JSON in this exact format:

{
  "question": "your question here",
  "options": ["option A", "option B", "option C", "option D"],
  "correctAnswer": 0,
  "difficulty": "${difficulty}",
  "explanation": "brief explanation of the correct answer"
}

Do NOT include any markdown, code blocks, or extra text. ONLY the JSON object.
`;

    console.log(`📡 Calling Gemini API: ${MODEL_NAME}`);

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
      { 
        timeout: 30000,
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    let text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      throw new Error("Empty response from Gemini");
    }

    // Clean the response
    text = text.replace(/```json|```/g, "").trim();
    text = text.replace(/^[^{]*/, "").replace(/[^}]*$/, "");

    const quiz = JSON.parse(text);

    // Validate structure
    if (!quiz.question || !Array.isArray(quiz.options) || quiz.options.length !== 4) {
      throw new Error("Invalid quiz structure from AI");
    }

    console.log("✅ Quiz generated successfully");

    return {
      success: true,
      quiz
    };

  } catch (error) {
    console.error("❌ Gemini API Error:", error.message);

    // Handle specific error codes
    if (error.response?.status === 429) {
      return {
        success: false,
        error: "AI service is busy. Please try again in a moment.",
        retryAfter: 30
      };
    }

    if (error.response?.status === 503) {
      return {
        success: false,
        error: "AI service temporarily unavailable. Please try again.",
        retryAfter: 10
      };
    }

    return {
      success: false,
      error: "Failed to generate quiz. Please try again.",
      fallback: true
    };
  }
}

module.exports = { generateQuiz };
// const axios = require("axios");

// const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// const MODEL_NAME = "gemini-pro";

// // Cooldown to prevent 429
// let lastCallTime = 0;
// const COOLDOWN_MS = 60 * 1000; // 1 minute

// async function generateQuiz(courseTitle, readmeContent, difficulty = null) {
//   console.log("📝 Starting quiz generation...");

//   const now = Date.now();
//   if (now - lastCallTime < COOLDOWN_MS) {
//     return {
//       success: false,
//       error: "Quiz generation is cooling down. Please wait a minute.",
//       retryAfter: 60
//     };
//   }

//   lastCallTime = now;

//   try {
//     if (!difficulty) {
//       const levels = ["easy", "medium", "hard"];
//       difficulty = levels[Math.floor(Math.random() * levels.length)];
//     }

//     const sanitizedContent = readmeContent
//       .replace(/\s+/g, " ")
//       .trim()
//       .substring(0, 8000);

//     const prompt = `
// You are an educational quiz generator.

// Topic: "${courseTitle}"
// Difficulty: ${difficulty}

// Content:
// ${sanitizedContent}

// Generate ONE MCQ.
// Return ONLY valid JSON:

// {
//   "question": "",
//   "options": ["", "", "", ""],
//   "correctAnswer": 0,
//   "difficulty": "${difficulty}",
//   "explanation": ""
// }
// `;

//     console.log(`🔄 Calling Gemini model: ${MODEL_NAME}`);

//     const url = `https://generativelanguage.googleapis.com/v1/models/${MODEL_NAME}:generateContent?key=${GEMINI_API_KEY}`;

//     const response = await axios.post(
//       url,
//       {
//         contents: [
//           {
//             role: "user",
//             parts: [{ text: prompt }]
//           }
//         ],
//         generationConfig: {
//           temperature: 0.7,
//           maxOutputTokens: 800
//         }
//       },
//       { timeout: 30000 }
//     );

//     let text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;

//     if (!text) {
//       throw new Error("Empty response from Gemini");
//     }

//     text = text.replace(/```json|```/g, "").trim();
//     text = text.replace(/^[^{]*/, "").replace(/[^}]*$/, "");

//     const quiz = JSON.parse(text);

//     if (!quiz.question || !Array.isArray(quiz.options)) {
//       throw new Error("Invalid quiz structure");
//     }

//     console.log("✅ Quiz generated successfully");

//     return {
//       success: true,
//       quiz
//     };

//   } catch (error) {
//     if (error.response?.status === 429) {
//       return {
//         success: false,
//         error: "AI is busy. Please try again in a minute.",
//         retryAfter: 60
//       };
//     }

//     console.error("❌ Gemini REST Error:", error.message);

//     return {
//       success: false,
//       error: "Quiz generation failed",
//       fallback: true
//     };
//   }
// }

// module.exports = { generateQuiz };