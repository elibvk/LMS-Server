// server/utils/contentFetcher.js
const axios = require('axios');
const cheerio = require('cheerio');

/**
 * Fetch and extract content from a URL
 * @param {string} url - The URL to fetch
 * @returns {Promise<string>} Cleaned text content
 */
async function fetchContentFromURL(url) {
  try {
    console.log(`🌐 Fetching content from: ${url}`);

    // Validate URL
    const urlObj = new URL(url);
    if (!['http:', 'https:'].includes(urlObj.protocol)) {
      throw new Error('Invalid URL protocol. Only HTTP/HTTPS allowed.');
    }

    // Fetch with timeout and size limit
    const response = await axios.get(url, {
      timeout: 15000, // 15 seconds
      maxContentLength: 5 * 1024 * 1024, // 5MB max
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; QuizBot/1.0)'
      }
    });

    const contentType = response.headers['content-type'] || '';

    // Handle plain text
    if (contentType.includes('text/plain')) {
      return sanitizeText(response.data);
    }

    // Handle HTML
    if (contentType.includes('text/html')) {
      const $ = cheerio.load(response.data);

      // Remove unwanted elements
      $('script, style, nav, footer, header, aside, iframe, noscript').remove();

      // Try to find main content
      let text = $('article').text() ||
                 $('main').text() ||
                 $('.content').text() ||
                 $('#content').text() ||
                 $('.post-content').text() ||
                 $('.article-content').text() ||
                 $('body').text();

      const cleaned = sanitizeText(text);

      if (cleaned.length < 100) {
        throw new Error('Could not extract meaningful content from URL. The page might be JavaScript-heavy or have restricted access.');
      }

      console.log(`✅ Extracted ${cleaned.length} characters from URL`);
      return cleaned;
    }

    throw new Error('Unsupported content type. Only HTML and plain text are supported.');

  } catch (error) {
    console.error('❌ Content fetch error:', error.message);

    if (error.code === 'ENOTFOUND') {
      throw new Error('URL not found. Please check the URL and try again.');
    }

    if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
      throw new Error('Request timeout. The URL took too long to respond.');
    }

    if (error.response?.status === 403) {
      throw new Error('Access forbidden. The website may be blocking automated requests.');
    }

    if (error.response?.status === 404) {
      throw new Error('Page not found (404). Please check the URL.');
    }

    if (error.response?.status >= 500) {
      throw new Error('The website is currently unavailable. Please try again later.');
    }

    throw error;
  }
}

/**
 * Sanitize and clean text content
 * @param {string} text - Raw text
 * @returns {string} Cleaned text
 */
function sanitizeText(text) {
  return text
    .replace(/\s+/g, ' ') // Collapse whitespace
    .replace(/\n\s*\n/g, '\n') // Remove empty lines
    .replace(/[^\w\s.,!?;:()\-'"]/g, '') // Remove special chars
    .trim()
    .slice(0, 10000); // Limit to 10k chars
}

/**
 * Validate content length
 * @param {string} content - Content to validate
 * @returns {Object} Validation result
 */
function validateContent(content) {
  const cleaned = content.trim();

  if (cleaned.length < 50) {
    return {
      valid: false,
      error: 'Content is too short. Please provide at least 50 characters.'
    };
  }

  if (cleaned.length > 10000) {
    return {
      valid: true,
      content: cleaned.slice(0, 10000),
      warning: 'Content truncated to 10,000 characters.'
    };
  }

  return {
    valid: true,
    content: cleaned
  };
}

module.exports = {
  fetchContentFromURL,
  sanitizeText,
  validateContent
};