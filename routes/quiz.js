// server/routes/quiz.js
const express = require('express');
const router = express.Router();
const Course = require('../models/Course');
const QuizQuestion = require('../models/QuizQuestion');
const QuizSession = require('../models/QuizSession');
const QuizSubmission = require('../models/QuizSubmission');
const { generateQuiz } = require('../services/geminiService');
const { verifyAuth } = require('../middleware/auth');
const fs = require('fs').promises;
const path = require('path');

const DOCS_ROOT = path.join(__dirname, '../../client/public/docs');

// ==================== ADMIN: PREPARE QUESTION ====================
// Returns existing questions OR generates new one
router.post('/question/prepare', verifyAuth, async (req, res) => {
  try {
    const { courseId, mode } = req.body; // mode: "new" | "existing"

    if (!courseId) {
      return res.status(400).json({ error: 'Course ID required' });
    }

    const course = await Course.findOne({ projectId: courseId });
    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    // MODE: EXISTING - Return available questions
    if (mode === 'existing') {
      const questions = await QuizQuestion.getAvailableForCourse(courseId);
      
      return res.json({
        success: true,
        mode: 'existing',
        questions: questions.map(q => ({
          id: q._id,
          question: q.question,
          options: q.options,
          difficulty: q.difficulty,
          timesUsed: q.timesUsed,
          lastUsedAt: q.lastUsedAt,
          createdAt: q.createdAt
        }))
      });
    }

    // MODE: NEW - Generate new question
    const readmePath = path.join(DOCS_ROOT, courseId, 'README.md');
    let readmeContent;
    
    try {
      readmeContent = await fs.readFile(readmePath, 'utf-8');
    } catch (err) {
      return res.status(404).json({ error: 'Course content not found' });
    }

    // Generate quiz using AI
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

    // Save new question to database
    const newQuestion = await QuizQuestion.create({
      courseId,
      question: result.quiz.question,
      options: result.quiz.options,
      correctAnswer: result.quiz.correctAnswer,
      difficulty: result.quiz.difficulty,
      explanation: result.quiz.explanation,
      createdBy: req.user.email,
      createdByName: req.user.name
    });

    res.json({
      success: true,
      mode: 'new',
      question: {
        id: newQuestion._id,
        question: newQuestion.question,
        options: newQuestion.options,
        difficulty: newQuestion.difficulty,
        explanation: newQuestion.explanation
      }
    });

  } catch (error) {
    console.error('Question prepare error:', error);
    res.status(500).json({ error: 'Failed to prepare question' });
  }
});

// ==================== ADMIN: CREATE SINGLE-QUESTION QUIZ ====================
router.post('/session/create-single', verifyAuth, async (req, res) => {
  try {
    const { questionId, duration } = req.body;

    if (!questionId) {
      return res.status(400).json({ error: 'Question ID required' });
    }

    if (!duration || duration < 30 || duration > 600) {
      return res.status(400).json({ error: 'Duration must be 30-600 seconds' });
    }

    const question = await QuizQuestion.findById(questionId);
    if (!question) {
      return res.status(404).json({ error: 'Question not found' });
    }

    // Generate unique code
    const quizCode = await QuizSession.generateUniqueCode();

    // Calculate expiry
    const startedAt = new Date();
    const expiresAt = new Date(startedAt.getTime() + duration * 1000);

    // Create session
    const session = await QuizSession.create({
      quizCode,
      sessionType: 'single',
      questionId: question._id,
      duration,
      startedAt,
      expiresAt,
      status: 'active', // Single questions are immediately active
      createdBy: req.user.email,
      createdByName: req.user.name,
      courseId: question.courseId,
      courseTitle: (await Course.findOne({ projectId: question.courseId }))?.title
    });

    // Mark question as active
    await question.activateInSession(session._id);
    await question.markAsUsed();

    res.status(201).json({
      success: true,
      quizCode: session.quizCode,
      expiresAt: session.expiresAt,
      duration: session.duration,
      sessionId: session._id
    });

  } catch (error) {
    console.error('Single session creation error:', error);
    res.status(500).json({ error: 'Failed to create quiz session' });
  }
});

// ==================== ADMIN: CREATE CLASS SESSION ====================
router.post('/session/create-class', verifyAuth, async (req, res) => {
  try {
    const { courseId, duration } = req.body; // duration in seconds (1-3 hours)

    if (!courseId) {
      return res.status(400).json({ error: 'Course ID required' });
    }

    if (!duration || duration < 1800 || duration > 10800) {
      return res.status(400).json({ 
        error: 'Duration must be 1800-10800 seconds (0.5-3 hours)' 
      });
    }

    const course = await Course.findOne({ projectId: courseId });
    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    // Generate class code
    const quizCode = await QuizSession.generateClassCode();

    const startedAt = new Date();
    const expiresAt = new Date(startedAt.getTime() + duration * 1000);

    const session = await QuizSession.create({
      quizCode,
      sessionType: 'class',
      duration,
      startedAt,
      expiresAt,
      status: 'waiting', // Starts in waiting state
      createdBy: req.user.email,
      createdByName: req.user.name,
      courseId,
      courseTitle: course.title,
      studentsJoined: []
    });

    res.status(201).json({
      success: true,
      sessionCode: session.quizCode,
      expiresAt: session.expiresAt,
      duration: session.duration,
      sessionId: session._id,
      message: 'Class session created. Students can join now.'
    });

  } catch (error) {
    console.error('Class session creation error:', error);
    res.status(500).json({ error: 'Failed to create class session' });
  }
});

// ==================== ADMIN: BROADCAST QUESTION IN CLASS ====================
router.post('/session/broadcast-question', verifyAuth, async (req, res) => {
  try {
    const { sessionCode, questionId } = req.body;

    if (!sessionCode) {
      return res.status(400).json({ error: 'Session code required' });
    }

    const session = await QuizSession.findOne({ quizCode: sessionCode });
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    if (session.sessionType !== 'class') {
      return res.status(400).json({ error: 'Only class sessions support broadcasting' });
    }

    if (session.createdBy !== req.user.email) {
      return res.status(403).json({ error: 'Only session creator can broadcast' });
    }

    if (session.isExpired()) {
      return res.status(410).json({ error: 'Session has expired' });
    }

    const question = await QuizQuestion.findById(questionId);
    if (!question) {
      return res.status(404).json({ error: 'Question not found' });
    }

    // Deactivate previous question if any
    if (session.activeQuestionId) {
      const prevQuestion = await QuizQuestion.findById(session.activeQuestionId);
      if (prevQuestion) {
        await prevQuestion.deactivateFromSession();
      }
    }

    // Broadcast new question
    await session.broadcastQuestion(question._id);
    await question.activateInSession(session._id);
    await question.markAsUsed();

    res.json({
      success: true,
      message: 'Question broadcasted to all students',
      questionId: question._id,
      studentsCount: session.studentsJoined.length
    });

  } catch (error) {
    console.error('Broadcast error:', error);
    res.status(500).json({ error: 'Failed to broadcast question' });
  }
});

// ==================== ADMIN: END CLASS SESSION ====================
router.post('/session/end-class', verifyAuth, async (req, res) => {
  try {
    const { sessionCode } = req.body;

    const session = await QuizSession.findOne({ quizCode: sessionCode });
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    if (session.createdBy !== req.user.email) {
      return res.status(403).json({ error: 'Only session creator can end session' });
    }

    // Deactivate current question
    if (session.activeQuestionId) {
      const question = await QuizQuestion.findById(session.activeQuestionId);
      if (question) {
        await question.deactivateFromSession();
      }
    }

    session.status = 'expired';
    await session.save();

    res.json({
      success: true,
      message: 'Class session ended',
      totalQuestions: session.questionsHistory.length,
      totalStudents: session.studentsJoined.length
    });

  } catch (error) {
    console.error('End session error:', error);
    res.status(500).json({ error: 'Failed to end session' });
  }
});

// ==================== STUDENT: JOIN SESSION ====================
router.post('/session/join', verifyAuth, async (req, res) => {
  try {
    const { code } = req.body;

    if (!code || (!/^\d{6}$/.test(code) && !/^CS_\d{6}$/.test(code))) {
      return res.status(400).json({ error: 'Invalid code format' });
    }

    const session = await QuizSession.findOne({ quizCode: code })
      .populate('questionId')
      .populate('activeQuestionId');

    if (!session) {
      return res.status(404).json({ error: 'Quiz not found or has ended' });
    }

    if (session.isExpired()) {
      session.status = 'expired';
      await session.save();
      return res.status(410).json({ error: 'Session has expired' });
    }

    // Add student to session (for class sessions)
    if (session.sessionType === 'class') {
      session.addStudent(req.user.email, req.user.name);
      await session.save();
    }

    // SINGLE QUESTION SESSION
    if (session.sessionType === 'single') {
      // Check if already submitted
      const existing = await QuizSubmission.findOne({
        quizSessionId: session._id,
        questionId: session.questionId._id,
        studentEmail: req.user.email
      });

      if (existing) {
        return res.status(409).json({ 
          error: 'You have already submitted an answer',
          alreadySubmitted: true
        });
      }

      return res.json({
        success: true,
        sessionType: 'single',
        status: 'active',
        sessionId: session._id,
        question: session.questionId.question,
        options: session.questionId.options,
        difficulty: session.questionId.difficulty,
        remainingTime: session.getRemainingTime(),
        courseTitle: session.courseTitle
      });
    }

    // CLASS SESSION
    if (session.status === 'waiting') {
      return res.json({
        success: true,
        sessionType: 'class',
        status: 'waiting',
        sessionId: session._id,
        courseTitle: session.courseTitle,
        message: 'Waiting for instructor to start quiz...'
      });
    }

    if (session.status === 'active' && session.activeQuestionId) {
      // Check if already submitted current question
      const existing = await QuizSubmission.findOne({
        quizSessionId: session._id,
        questionId: session.activeQuestionId._id,
        studentEmail: req.user.email
      });

      if (existing) {
        return res.json({
          success: true,
          sessionType: 'class',
          status: 'submitted',
          message: 'You already submitted this question. Waiting for next question...'
        });
      }

      return res.json({
        success: true,
        sessionType: 'class',
        status: 'active',
        sessionId: session._id,
        question: session.activeQuestionId.question,
        options: session.activeQuestionId.options,
        difficulty: session.activeQuestionId.difficulty,
        courseTitle: session.courseTitle
      });
    }

    res.json({
      success: true,
      sessionType: 'class',
      status: 'waiting',
      sessionId: session._id,
      courseTitle: session.courseTitle
    });

  } catch (error) {
    console.error('Join error:', error);
    res.status(500).json({ error: 'Failed to join session' });
  }
});

// ==================== STUDENT: POLL FOR UPDATES (Class Sessions) ====================
router.get('/session/poll/:code', verifyAuth, async (req, res) => {
  try {
    const { code } = req.params;

    const session = await QuizSession.findOne({ quizCode: code })
      .populate('activeQuestionId');

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    if (session.sessionType !== 'class') {
      return res.status(400).json({ error: 'Polling only for class sessions' });
    }

    if (session.isExpired()) {
      return res.json({
        status: 'expired',
        message: 'Session has ended'
      });
    }

    if (session.status === 'waiting') {
      return res.json({
        status: 'waiting',
        hasQuestion: false
      });
    }

    if (session.status === 'active' && session.activeQuestionId) {
      // Check if student already submitted
      const submission = await QuizSubmission.findOne({
        quizSessionId: session._id,
        questionId: session.activeQuestionId._id,
        studentEmail: req.user.email
      });

      if (submission) {
        return res.json({
          status: 'submitted',
          hasQuestion: false,
          message: 'Waiting for next question...'
        });
      }

      return res.json({
        status: 'active',
        hasQuestion: true,
        question: session.activeQuestionId.question,
        options: session.activeQuestionId.options,
        difficulty: session.activeQuestionId.difficulty,
        questionId: session.activeQuestionId._id
      });
    }

    res.json({
      status: 'waiting',
      hasQuestion: false
    });

  } catch (error) {
    console.error('Poll error:', error);
    res.status(500).json({ error: 'Polling failed' });
  }
});

// ==================== STUDENT: SUBMIT ANSWER ====================
router.post('/session/submit', verifyAuth, async (req, res) => {
  try {
    const { code, selectedOption } = req.body;

    if (!code || selectedOption === undefined) {
      return res.status(400).json({ error: 'Code and option required' });
    }

    if (![0, 1, 2, 3].includes(selectedOption)) {
      return res.status(400).json({ error: 'Invalid option' });
    }

    const session = await QuizSession.findOne({ quizCode: code });
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    if (session.isExpired()) {
      return res.status(410).json({ error: 'Session has expired' });
    }

    // Determine which question to check
    let questionId;
    if (session.sessionType === 'single') {
      questionId = session.questionId;
    } else {
      questionId = session.activeQuestionId;
    }

    if (!questionId) {
      return res.status(400).json({ error: 'No active question' });
    }

    const question = await QuizQuestion.findById(questionId);
    if (!question) {
      return res.status(404).json({ error: 'Question not found' });
    }

    // Check duplicate
    const existing = await QuizSubmission.findOne({
      quizSessionId: session._id,
      questionId: question._id,
      studentEmail: req.user.email
    });

    if (existing) {
      return res.status(409).json({ error: 'Already submitted' });
    }

    // Calculate time taken
    const broadcastTime = session.sessionType === 'single' 
      ? session.startedAt 
      : session.questionsHistory.find(q => q.questionId.toString() === question._id.toString())?.broadcastedAt || session.startedAt;

    const timeTaken = Math.floor((Date.now() - broadcastTime.getTime()) / 1000);

    const isCorrect = selectedOption === question.correctAnswer;

    // Save submission
    await QuizSubmission.create({
      quizSessionId: session._id,
      questionId: question._id,
      studentEmail: req.user.email,
      studentName: req.user.name,
      selectedOption,
      isCorrect,
      timeTaken
    });

    res.json({
      success: true,
      isCorrect,
      correctAnswer: question.correctAnswer,
      correctOption: question.options[question.correctAnswer],
      explanation: question.explanation,
      timeTaken
    });

  } catch (error) {
    console.error('Submit error:', error);
    
    if (error.code === 11000) {
      return res.status(409).json({ error: 'Already submitted' });
    }

    res.status(500).json({ error: 'Failed to submit answer' });
  }
});

// ==================== ADMIN: GET SESSION RESULTS ====================
router.get('/session/:sessionId/results', verifyAuth, async (req, res) => {
  try {
    const session = await QuizSession.findById(req.params.sessionId)
      .populate('questionId')
      .populate('activeQuestionId')
      .populate('questionsHistory.questionId');

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    if (session.createdBy !== req.user.email && !req.user.isAdmin) {
      return res.status(403).json({ error: 'No permission' });
    }

    const submissions = await QuizSubmission.find({ 
      quizSessionId: session._id 
    }).populate('questionId').sort({ submittedAt: 1 });

    const stats = {
      totalSubmissions: submissions.length,
      correctCount: submissions.filter(s => s.isCorrect).length,
      incorrectCount: submissions.filter(s => !s.isCorrect).length,
      averageTime: submissions.length > 0 
        ? submissions.reduce((sum, s) => sum + s.timeTaken, 0) / submissions.length 
        : 0
    };

    // ✅ FIX: Include courseId in response
    res.json({
      session: {
        type: session.sessionType,
        code: session.quizCode,
        courseId: session.courseId,  // ✅ ADD THIS
        courseTitle: session.courseTitle,
        status: session.status,
        duration: session.duration,
        expiresAt: session.expiresAt,
        studentsJoined: session.studentsJoined?.length || 0
      },
      stats,
      submissions: submissions.map(s => ({
        studentName: s.studentName,
        studentEmail: s.studentEmail,
        question: s.questionId?.question,
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
