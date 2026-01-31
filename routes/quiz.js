// server/routes/quiz.js - COMPLETE NEW VERSION
const express = require('express');
const router = express.Router();
const Question = require('../models/Quiz/Question');
const ActiveQuiz = require('../models/Quiz/ActiveQuiz');
const { generateQuestionWithChatGPT } = require('../services/chatgptService');
const { fetchContentFromURL, validateContent } = require('../utils/contentFetcher');
const { verifyAuth } = require('../middleware/auth');

// ===== ADMIN: Get list of existing questions for a course =====
router.get('/questions/list', verifyAuth, async (req, res) => {
  try {
    const { courseId } = req.query;

    if (!courseId) {
      return res.status(400).json({ error: 'Course ID is required' });
    }

    const questions = await Question.find({ courseId })
      .select('question difficulty usageCount lastUsedAt createdAt')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      count: questions.length,
      questions: questions.map(q => ({
        _id: q._id,
        question: q.question.length > 100 ? q.question.substring(0, 100) + '...' : q.question,
        difficulty: q.difficulty,
        usageCount: q.usageCount,
        lastUsedAt: q.lastUsedAt,
        createdAt: q.createdAt
      }))
    });

  } catch (error) {
    console.error('List questions error:', error);
    res.status(500).json({ error: 'Failed to fetch questions' });
  }
});

// ===== ADMIN: Generate new question with ChatGPT =====
router.post('/questions/generate', verifyAuth, async (req, res) => {
  try {
    const { courseId, source, sourceContent, difficulty } = req.body;

    // Validation
    if (!courseId) {
      return res.status(400).json({ error: 'Course ID is required' });
    }

    if (!source || !['content', 'url'].includes(source)) {
      return res.status(400).json({ error: 'Invalid source type' });
    }

    if (!sourceContent) {
      return res.status(400).json({ error: 'Source content is required' });
    }

    // Get content based on source
    let content;
    if (source === 'url') {
      try {
        content = await fetchContentFromURL(sourceContent);
      } catch (error) {
        return res.status(400).json({ error: error.message });
      }
    } else {
      // Validate pasted content
      const validation = validateContent(sourceContent);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
      }
      content = validation.content;
    }

    // Generate question with ChatGPT
    const result = await generateQuestionWithChatGPT(content, difficulty || 'medium');

    if (!result.success) {
      return res.status(result.retryAfter ? 429 : 500).json({
        error: result.error,
        retryAfter: result.retryAfter
      });
    }

    // Save question to database
    const question = await Question.create({
      courseId,
      question: result.question.question,
      options: result.question.options,
      correctAnswer: result.question.correctAnswer,
      explanation: result.question.explanation,
      difficulty: result.question.difficulty,
      source,
      sourceContent,
      createdBy: req.user.email
    });

    res.status(201).json({
      success: true,
      message: 'Question generated and saved successfully',
      questionId: question._id,
      question: {
        _id: question._id,
        question: question.question,
        options: question.options,
        difficulty: question.difficulty
      }
    });

  } catch (error) {
    console.error('Generate question error:', error);
    res.status(500).json({ error: 'Failed to generate question' });
  }
});

// ===== ADMIN: Activate a question (make it live for students) =====
router.post('/questions/activate', verifyAuth, async (req, res) => {
  try {
    const { questionId, courseId } = req.body;

    if (!questionId || !courseId) {
      return res.status(400).json({ error: 'Question ID and Course ID are required' });
    }

    // Find the question
    const question = await Question.findById(questionId);

    if (!question) {
      return res.status(404).json({ error: 'Question not found' });
    }

    if (question.courseId !== courseId) {
      return res.status(403).json({ error: 'Question does not belong to this course' });
    }

    // Check if there's already an active quiz for this course
    const existing = await ActiveQuiz.findOne({ courseId });

    if (existing) {
      // Close existing quiz and create new one
      await ActiveQuiz.deleteOne({ courseId });
    }

    // Create active quiz
    const activeQuiz = await ActiveQuiz.create({
      courseId,
      questionId: question._id,
      question: question.question,
      options: question.options,
      correctAnswer: question.correctAnswer,
      explanation: question.explanation,
      activatedBy: req.user.email,
      activatedAt: new Date(),
      submissionCount: 0,
      correctCount: 0,
      submissions: []
    });

    // Increment usage count
    await question.incrementUsage();

    res.json({
      success: true,
      message: 'Question activated successfully',
      activeQuizId: activeQuiz._id
    });

  } catch (error) {
    console.error('Activate question error:', error);
    res.status(500).json({ error: 'Failed to activate question' });
  }
});

// ===== ADMIN: Close active question =====
router.post('/questions/close', verifyAuth, async (req, res) => {
  try {
    const { courseId } = req.body;

    if (!courseId) {
      return res.status(400).json({ error: 'Course ID is required' });
    }

    const activeQuiz = await ActiveQuiz.findOne({ courseId });

    if (!activeQuiz) {
      return res.status(404).json({ error: 'No active quiz found for this course' });
    }

    // Delete active quiz
    await ActiveQuiz.deleteOne({ courseId });

    res.json({
      success: true,
      message: 'Question closed successfully',
      stats: {
        totalSubmissions: activeQuiz.submissionCount,
        correctSubmissions: activeQuiz.correctCount
      }
    });

  } catch (error) {
    console.error('Close question error:', error);
    res.status(500).json({ error: 'Failed to close question' });
  }
});

// ===== STUDENT: Get active question for a course =====
router.get('/active', verifyAuth, async (req, res) => {
  try {
    const { courseId } = req.query;

    if (!courseId) {
      return res.status(400).json({ error: 'Course ID is required' });
    }

    const activeQuiz = await ActiveQuiz.findOne({ courseId });

    if (!activeQuiz) {
      return res.json({
        success: true,
        hasActive: false
      });
    }

    // Check if student already submitted
    const hasSubmitted = activeQuiz.hasStudentSubmitted(req.user.id);

    res.json({
      success: true,
      hasActive: true,
      hasSubmitted,
      activeQuizId: activeQuiz._id,
      question: activeQuiz.question,
      options: activeQuiz.options,
      submissionCount: activeQuiz.submissionCount,
      activatedAt: activeQuiz.activatedAt
    });

  } catch (error) {
    console.error('Get active question error:', error);
    res.status(500).json({ error: 'Failed to fetch active question' });
  }
});

// ===== STUDENT: Submit answer =====
router.post('/submit', verifyAuth, async (req, res) => {
  try {
    const { activeQuizId, selectedOption } = req.body;

    if (!activeQuizId || selectedOption === undefined) {
      return res.status(400).json({ error: 'Active quiz ID and selected option are required' });
    }

    if (![0, 1, 2, 3].includes(selectedOption)) {
      return res.status(400).json({ error: 'Invalid option selected' });
    }

    // Find active quiz
    const activeQuiz = await ActiveQuiz.findById(activeQuizId);

    if (!activeQuiz) {
      return res.status(404).json({ error: 'Quiz not found or has been closed' });
    }

    // Check if already submitted
    if (activeQuiz.hasStudentSubmitted(req.user.id)) {
      return res.status(409).json({ error: 'You have already submitted an answer' });
    }

    // Check correctness
    const isCorrect = selectedOption === activeQuiz.correctAnswer;

    // Add submission
    await activeQuiz.addSubmission({
      studentId: req.user.id,
      studentEmail: req.user.email,
      studentName: req.user.name,
      selectedOption,
      isCorrect,
      submittedAt: new Date()
    });

    // Return result
    res.json({
      success: true,
      isCorrect,
      correctAnswer: activeQuiz.correctAnswer,
      correctOption: activeQuiz.options[activeQuiz.correctAnswer],
      explanation: activeQuiz.explanation,
      submissionCount: activeQuiz.submissionCount
    });

  } catch (error) {
    console.error('Submit answer error:', error);
    res.status(500).json({ error: 'Failed to submit answer' });
  }
});

// ===== ADMIN: Get quiz statistics =====
router.get('/stats/:activeQuizId', verifyAuth, async (req, res) => {
  try {
    const activeQuiz = await ActiveQuiz.findById(req.params.activeQuizId);

    if (!activeQuiz) {
      return res.status(404).json({ error: 'Active quiz not found' });
    }

    // Check permission
    if (activeQuiz.activatedBy !== req.user.email && !req.user.isAdmin) {
      return res.status(403).json({ error: 'You do not have permission to view these stats' });
    }

    res.json({
      success: true,
      question: activeQuiz.question,
      stats: {
        totalSubmissions: activeQuiz.submissionCount,
        correctSubmissions: activeQuiz.correctCount,
        incorrectSubmissions: activeQuiz.submissionCount - activeQuiz.correctCount,
        accuracy: activeQuiz.submissionCount > 0 
          ? Math.round((activeQuiz.correctCount / activeQuiz.submissionCount) * 100)
          : 0
      },
      submissions: activeQuiz.submissions.map(s => ({
        studentName: s.studentName,
        studentEmail: s.studentEmail,
        selectedOption: s.selectedOption,
        isCorrect: s.isCorrect,
        submittedAt: s.submittedAt
      }))
    });

  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

module.exports = router;