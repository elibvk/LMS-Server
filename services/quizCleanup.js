// services/quizCleanup.js
const QuizSession = require('../models/QuizSession');

/**
 * Background service to auto-expire quiz sessions
 * Run this as a scheduled job (cron) or using node-cron
 */
class QuizCleanupService {
  constructor() {
    this.intervalId = null;
    this.isRunning = false;
  }

  /**
   * Start the cleanup service
   * @param {number} intervalMs - Interval in milliseconds (default: 30 seconds)
   */
  start(intervalMs = 30000) {
    if (this.isRunning) {
      console.log('Cleanup service already running');
      return;
    }

    console.log('Starting quiz cleanup service...');
    this.isRunning = true;

    // Run immediately
    this.cleanupExpiredQuizzes();

    // Then run at intervals
    this.intervalId = setInterval(() => {
      this.cleanupExpiredQuizzes();
    }, intervalMs);
  }

  /**
   * Stop the cleanup service
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      this.isRunning = false;
      console.log('Quiz cleanup service stopped');
    }
  }

  /**
   * Find and expire quiz sessions
   */
  async cleanupExpiredQuizzes() {
    try {
      const now = new Date();

      const result = await QuizSession.updateMany(
        {
          status: 'active',
          expiresAt: { $lte: now }
        },
        {
          $set: { status: 'expired' }
        }
      );

      if (result.modifiedCount > 0) {
        console.log(`Expired ${result.modifiedCount} quiz session(s) at ${now.toISOString()}`);
      }

    } catch (error) {
      console.error('Quiz cleanup error:', error);
    }
  }

  /**
   * Get statistics about quiz sessions
   */
  async getStats() {
    try {
      const [active, expired, total] = await Promise.all([
        QuizSession.countDocuments({ status: 'active' }),
        QuizSession.countDocuments({ status: 'expired' }),
        QuizSession.countDocuments()
      ]);

      return {
        active,
        expired,
        total,
        timestamp: new Date()
      };
    } catch (error) {
      console.error('Stats retrieval error:', error);
      return null;
    }
  }
}

// Export singleton instance
const cleanupService = new QuizCleanupService();

module.exports = cleanupService;

// Usage in your main app file (app.js or server.js):
/*
const cleanupService = require('./services/quizCleanup');

// Start the service when server starts
cleanupService.start(30000); // Run every 30 seconds

// Graceful shutdown
process.on('SIGTERM', () => {
  cleanupService.stop();
  process.exit(0);
});
*/