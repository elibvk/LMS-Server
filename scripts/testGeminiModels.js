// server/test-gemini-models.js
require('dotenv').config({ path: '../.env' });
const axios = require('axios');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

async function listModels() {
  try {
    console.log('🔍 Fetching available Gemini models...\n');
    
    const response = await axios.get(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_API_KEY}`
    );

    const models = response.data.models || [];
    
    console.log(`✅ Found ${models.length} models\n`);
    
    // Filter models that support generateContent
    const contentModels = models.filter(m => 
      m.supportedGenerationMethods?.includes('generateContent')
    );

    console.log('📋 Models that support generateContent:\n');
    contentModels.forEach(model => {
      console.log(`  ✓ ${model.name}`);
      console.log(`    Display Name: ${model.displayName}`);
      console.log(`    Version: ${model.version}`);
      console.log('');
    });

    console.log('\n🎯 Recommended model names to use:');
    contentModels.slice(0, 3).forEach(model => {
      const modelName = model.name.replace('models/', '');
      console.log(`  - "${modelName}"`);
    });

  } catch (error) {
    console.error('❌ Error:', error.response?.data || error.message);
  }
}

listModels();