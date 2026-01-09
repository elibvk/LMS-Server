// server/routes/quiz.js
const express = require('express');
const router = express.Router();
const Course = require('../models/Course');
const QuizSession = require('../models/QuizSession');
const QuizSubmission = require('../models/QuizSubmission');
const { generateQuiz } = require('../services/geminiService');
const { verifyAuth, verifyAdmin } = require('../middleware/auth');
const fs = require('fs').promises;
const path = require('path');

// ===== EXISTING ENDPOINT: Generate Quiz (Single Question) =====
router.post('/generate', verifyAuth, async (req, res) => {
  try {
    const { projectId } = req.body;

    if (!projectId) {
      return res.status(400).json({ 
        success: false,
        error: 'Project ID is required' 
      });
    }

    // Fetch course
    const course = await Course.findOne({ projectId });
    
    if (!course) {
      return res.status(404).json({ 
        success: false,
        error: 'Course not found' 
      });
    }

    // Read README content
    const readmePath = path.join(
      __dirname, 
      '../../client/public/docs', 
      projectId, 
      'README.md'
    );

    let readmeContent;
    try {
      readmeContent = await fs.readFile(readmePath, 'utf-8');
    } catch (err) {
      return res.status(404).json({ 
        success: false,
        error: 'Course content not found' 
      });
    }

    // Generate quiz using Gemini
    const result = await generateQuiz(
      course.title, 
      readmeContent, 
      'medium'
    );

    if (!result.success) {
      return res.status(result.retryAfter ? 429 : 500).json(result);
    }

    res.json({
      success: true,
      quiz: result.quiz,
      courseTitle: course.title
    });

  } catch (error) {
    console.error('Quiz generation error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to generate quiz' 
    });
  }
});

// ===== NEW: Create Live Quiz Session =====
router.post('/session/create', verifyAuth, async (req, res) => {
  try {
    const { projectId, duration } = req.body;

    // Validate
    if (!projectId) {
      return res.status(400).json({ error: 'Project ID required' });
    }

    if (!duration || duration < 30 || duration > 600) {
      return res.status(400).json({ 
        error: 'Duration must be between 30 and 600 seconds' 
      });
    }

    // Fetch course
    const course = await Course.findOne({ projectId });
    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    // Read README
    const readmePath = path.join(
      __dirname, 
      '../../client/public/docs', 
      projectId, 
      'README.md'
    );

    let readmeContent;
    try {
      readmeContent = await fs.readFile(readmePath, 'utf-8');
    } catch (err) {
      return res.status(404).json({ error: 'Course content not found' });
    }

    // Generate quiz
    const result = await generateQuiz(course.title, readmeContent, 'medium');

    if (!result.success) {
      if (result.retryAfter) {
        return res.status(429).json({ 
          error: result.error,
          retryAfter: result.retryAfter 
        });
      }
      return res.status(500).json({ error: result.error });
    }

    // Generate unique code
    const quizCode = await QuizSession.generateUniqueCode();

    // Calculate expiry
    const startedAt = new Date();
    const expiresAt = new Date(startedAt.getTime() + duration * 1000);

    // Create session
    const session = await QuizSession.create({
      quizCode,
      question: result.quiz.question,
      options: result.quiz.options,
      correctAnswer: result.quiz.correctAnswer,
      difficulty: result.quiz.difficulty,
      explanation: result.quiz.explanation,
      duration,
      startedAt,
      expiresAt,
      createdBy: req.user.email,
      createdByName: req.user.name,
      status: 'active',
      courseId: projectId,
      courseTitle: course.title
    });

    res.status(201).json({
      success: true,
      quizCode: session.quizCode,
      expiresAt: session.expiresAt,
      duration: session.duration,
      sessionId: session._id
    });

  } catch (error) {
    console.error('Session creation error:', error);
    res.status(500).json({ 
      error: 'Failed to create quiz session' 
    });
  }
});

// ===== NEW: Join Quiz Session (Students) =====
router.post('/session/join', verifyAuth, async (req, res) => {
  try {
    const { quizCode } = req.body;

    if (!quizCode || !/^\d{6}$/.test(quizCode)) {
      return res.status(400).json({ error: 'Invalid quiz code format' });
    }

    // Find active session
    const session = await QuizSession.findOne({ 
      quizCode, 
      status: 'active' 
    });

    if (!session) {
      return res.status(404).json({ 
        error: 'Quiz not found or has ended' 
      });
    }

    // Check expiry
    if (session.isExpired()) {
      session.status = 'expired';
      await session.save();
      return res.status(410).json({ error: 'Quiz has expired' });
    }

    // Check if already submitted
    const existing = await QuizSubmission.findOne({
      quizSessionId: session._id,
      studentEmail: req.user.email
    });

    if (existing) {
      return res.status(409).json({ 
        error: 'You have already submitted an answer for this quiz',
        alreadySubmitted: true
      });
    }

    // Return quiz data
    res.json({
      success: true,
      sessionId: session._id,
      question: session.question,
      options: session.options,
      difficulty: session.difficulty,
      remainingTime: session.getRemainingTime(),
      startedAt: session.startedAt,
      expiresAt: session.expiresAt,
      courseTitle: session.courseTitle
    });

  } catch (error) {
    console.error('Join error:', error);
    res.status(500).json({ error: 'Failed to join quiz' });
  }
});

// ===== NEW: Submit Quiz Answer =====
router.post('/session/submit', verifyAuth, async (req, res) => {
  try {
    const { quizCode, selectedOption } = req.body;

    if (!quizCode || selectedOption === undefined) {
      return res.status(400).json({ 
        error: 'Quiz code and selected option required' 
      });
    }

    // Validate option
    if (![0, 1, 2, 3].includes(selectedOption)) {
      return res.status(400).json({ error: 'Invalid option' });
    }

    // Find session
    const session = await QuizSession.findOne({ quizCode });

    if (!session) {
      return res.status(404).json({ error: 'Quiz not found' });
    }

    // Check expiry
    if (session.isExpired()) {
      session.status = 'expired';
      await session.save();
      return res.status(410).json({ error: 'Quiz has expired' });
    }

    // Check duplicate
    const existing = await QuizSubmission.findOne({
      quizSessionId: session._id,
      studentEmail: req.user.email
    });

    if (existing) {
      return res.status(409).json({ 
        error: 'Answer already submitted' 
      });
    }

    // Calculate time taken
    const timeTaken = Math.floor(
      (Date.now() - session.startedAt.getTime()) / 1000
    );

    // Check correctness
    const isCorrect = selectedOption === session.correctAnswer;

    // Save submission
    await QuizSubmission.create({
      quizSessionId: session._id,
      studentEmail: req.user.email,
      studentName: req.user.name,
      selectedOption,
      isCorrect,
      timeTaken,
      submittedAt: new Date()
    });

    // Return result
    res.json({
      success: true,
      isCorrect,
      correctAnswer: session.correctAnswer,
      correctOption: session.options[session.correctAnswer],
      explanation: session.explanation,
      timeTaken
    });

  } catch (error) {
    console.error('Submit error:', error);
    
    if (error.code === 11000) {
      return res.status(409).json({ 
        error: 'Answer already submitted' 
      });
    }

    res.status(500).json({ error: 'Failed to submit answer' });
  }
});

// ===== NEW: Get Session Results (Admin/Creator) =====
router.get('/session/:sessionId/results', verifyAuth, async (req, res) => {
  try {
    const session = await QuizSession.findById(req.params.sessionId);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Check permission
    if (session.createdBy !== req.user.email && !req.user.isAdmin) {
      return res.status(403).json({ 
        error: 'You do not have permission to view these results' 
      });
    }

    // Get submissions
    const submissions = await QuizSubmission.find({ 
      quizSessionId: session._id 
    }).sort({ submittedAt: 1 });

    // Calculate stats
    const stats = {
      totalSubmissions: submissions.length,
      correctCount: submissions.filter(s => s.isCorrect).length,
      incorrectCount: submissions.filter(s => !s.isCorrect).length,
      averageTime: submissions.length > 0 
        ? submissions.reduce((sum, s) => sum + s.timeTaken, 0) / submissions.length 
        : 0
    };

    res.json({
      session: {
        question: session.question,
        options: session.options,
        correctAnswer: session.correctAnswer,
        difficulty: session.difficulty,
        duration: session.duration,
        status: session.status,
        courseTitle: session.courseTitle
      },
      stats,
      submissions: submissions.map(s => ({
        studentName: s.studentName,
        studentEmail: s.studentEmail,
        selectedOption: s.selectedOption,
        isCorrect: s.isCorrect,
        timeTaken: s.timeTaken,
        submittedAt: s.submittedAt
      }))
    });

  } catch (error) {
    console.error('Results error:', error);
    res.status(500).json({ error: 'Failed to fetch results' });
  }
});

module.exports = router;
// // server/routes/quiz.js
// const express = require('express');
// const router = express.Router();
// const { verifyAuth } = require('../middleware/auth'); // 🔄 CHANGED from verifyAdmin
// const { generateQuiz } = require('../services/geminiService');
// const Course = require('../models/Course');
// const fs = require('fs').promises;
// const path = require('path');

// const DOCS_ROOT = path.join(__dirname, '../../client/public/docs');

// // Simple in-memory rate limiting
// const rateLimitMap = new Map();
// const RATE_LIMIT_WINDOW = 60000; // 1 minute
// const MAX_REQUESTS = 10; // 10 quizzes per minute per user

// function checkRateLimit(userId) {
//   const now = Date.now();
//   const userRequests = rateLimitMap.get(userId) || [];
  
//   // Filter requests within the time window
//   const recentRequests = userRequests.filter(time => now - time < RATE_LIMIT_WINDOW);
  
//   if (recentRequests.length >= MAX_REQUESTS) {
//     return false; // Rate limit exceeded
//   }
  
//   recentRequests.push(now);
//   rateLimitMap.set(userId, recentRequests);
//   return true;
// }

// // Clean up old rate limit entries every 5 minutes
// setInterval(() => {
//   const now = Date.now();
//   for (const [userId, requests] of rateLimitMap.entries()) {
//     const recentRequests = requests.filter(time => now - time < RATE_LIMIT_WINDOW);
//     if (recentRequests.length === 0) {
//       rateLimitMap.delete(userId);
//     } else {
//       rateLimitMap.set(userId, recentRequests);
//     }
//   }
// }, 5 * 60 * 1000);

// // POST /api/quiz/generate
// // 🔄 CHANGED: Now uses verifyAuth instead of verifyAdmin
// router.post('/generate', verifyAuth, async (req, res) => {
//   try {
//     const { projectId, difficulty } = req.body;
//     const userId = req.user.email; // Works for both admin and user

//     if (!projectId) {
//       return res.status(400).json({ error: 'projectId is required' });
//     }

//     // Validate difficulty if provided
//     if (difficulty && !['easy', 'medium', 'hard'].includes(difficulty)) {
//       return res.status(400).json({ error: 'Invalid difficulty level' });
//     }

//     // Check rate limit
//     if (!checkRateLimit(userId)) {
//       return res.status(429).json({ 
//         error: 'Too many quiz requests. Please wait a moment and try again.',
//         retryAfter: 60 
//       });
//     }

//     // Get course metadata from MongoDB
//     const course = await Course.findOne({ projectId });
//     if (!course) {
//       return res.status(404).json({ error: 'Course not found' });
//     }

//     // Read README.md content from disk
//     const readmePath = path.join(DOCS_ROOT, projectId, 'README.md');
//     let readmeContent;
    
//     try {
//       readmeContent = await fs.readFile(readmePath, 'utf8');
//     } catch (err) {
//       console.error(`Error reading README for ${projectId}:`, err);
//       return res.status(404).json({ 
//         error: 'Course content not found',
//         message: 'README.md file is missing or unreadable'
//       });
//     }

//     // Validate content length
//     if (!readmeContent || readmeContent.trim().length < 100) {
//       return res.status(400).json({ 
//         error: 'Course content too short to generate quiz',
//         message: 'Please add more content to this topic before generating quizzes'
//       });
//     }

//     console.log(`🎯 Generating quiz for ${projectId} (${course.title}) by ${userId}...`);

//     // Generate quiz using Gemini AI
//     const result = await generateQuiz(
//       course.title, 
//       readmeContent,
//       difficulty
//     );

//     if (!result.success) {
//       return res.status(500).json({ 
//         error: result.error,
//         message: 'Failed to generate quiz. Please try again.',
//         canRetry: true
//       });
//     }

//     console.log(`✅ Quiz generated for ${projectId} by ${userId} (${req.user.role})`);

//     res.json({
//       success: true,
//       quiz: result.quiz,
//       courseTitle: course.title,
//       projectId: projectId
//     });

//   } catch (error) {
//     console.error('Error generating quiz:', error);
//     res.status(500).json({ 
//       error: 'Failed to generate quiz',
//       message: error.message,
//       canRetry: true
//     });
//   }
// });

// // POST /api/quiz/validate
// // Optional endpoint for answer validation (future use)
// router.post('/validate', verifyAuth, async (req, res) => {
//   try {
//     const { projectId, userAnswer, correctAnswer } = req.body;

//     if (typeof userAnswer !== 'number' || typeof correctAnswer !== 'number') {
//       return res.status(400).json({ error: 'Invalid answer format' });
//     }

//     const isCorrect = userAnswer === correctAnswer;

//     res.json({
//       success: true,
//       correct: isCorrect
//     });

//   } catch (error) {
//     console.error('Error validating answer:', error);
//     res.status(500).json({ error: 'Validation failed' });
//   }
// });

// module.exports = router;
