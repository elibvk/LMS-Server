// server/scripts/updateIndexHtml.js
const fs = require('fs').promises;
const path = require('path');

const DOCS_ROOT = path.join(__dirname, '../../client/public/docs');
const TEMPLATE_PATH = path.join(__dirname, '../utils/indexTemplate.html');

async function updateAllIndexFiles() {
  try {
    console.log('🔄 Starting index.html update for all topics...\n');
    
    // Read the template
    const template = await fs.readFile(TEMPLATE_PATH, 'utf8');
    
    // Get all directories in docs
    const entries = await fs.readdir(DOCS_ROOT, { withFileTypes: true });
    const topicDirs = entries
      .filter(entry => entry.isDirectory() && /^\d{4}$/.test(entry.name))
      .map(entry => entry.name);
    
    console.log(`📁 Found ${topicDirs.length} topic directories\n`);
    
    let updated = 0;
    let skipped = 0;
    
    for (const topicId of topicDirs) {
      const indexPath = path.join(DOCS_ROOT, topicId, 'index.html');
      
      try {
        // Check if index.html exists
        await fs.access(indexPath);
        
        // Read current index.html to get title
        const currentContent = await fs.readFile(indexPath, 'utf8');
        const titleMatch = currentContent.match(/<title>(.*?)<\/title>/);
        const title = titleMatch ? titleMatch[1] : topicId;
        
        // Generate new content with title
        const newContent = template.replace(/__COURSE_TITLE__/g, title);
        
        // Write updated file
        await fs.writeFile(indexPath, newContent, 'utf8');
        
        console.log(`✅ Updated: ${topicId} (${title})`);
        updated++;
        
      } catch (err) {
        if (err.code === 'ENOENT') {
          console.log(`⏭️  Skipped: ${topicId} (no index.html)`);
          skipped++;
        } else {
          console.error(`❌ Error updating ${topicId}:`, err.message);
        }
      }
    }
    
    console.log(`\n📊 Summary:`);
    console.log(`   Updated: ${updated}`);
    console.log(`   Skipped: ${skipped}`);
    console.log(`   Total:   ${topicDirs.length}`);
    console.log('\n✅ Migration complete!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run the migration
updateAllIndexFiles();