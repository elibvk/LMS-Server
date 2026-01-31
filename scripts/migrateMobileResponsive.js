// server/scripts/migrateMobileResponsive.js
const fs = require('fs').promises;
const path = require('path');

const DOCS_ROOT = path.join(process.cwd(), 'client/public/docs');
const TEMPLATE_PATH = path.join(__dirname, '../utils/indexTemplate.html');

// ANSI color codes for better console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function migrateToMobileResponsive() {
  try {
    log('\n========================================', 'cyan');
    log('📱 Mobile Responsive Migration Tool', 'bright');
    log('========================================\n', 'cyan');
    
    log('📂 Reading new mobile-responsive template...', 'blue');
    const template = await fs.readFile(TEMPLATE_PATH, 'utf8');
    
    log('📁 Scanning docs directory...', 'blue');
    const entries = await fs.readdir(DOCS_ROOT, { withFileTypes: true });
    const topicDirs = entries
      .filter(entry => entry.isDirectory() && /^\d{4}$/.test(entry.name))
      .map(entry => entry.name)
      .sort();
    
    log(`\n🔍 Found ${topicDirs.length} course directories\n`, 'cyan');
    
    let stats = {
      updated: 0,
      skipped: 0,
      errors: 0,
      totalDirs: topicDirs.length
    };
    
    // Process each topic directory
    for (const topicId of topicDirs) {
      const indexPath = path.join(DOCS_ROOT, topicId, 'index.html');
      
      try {
        // Check if index.html exists
        await fs.access(indexPath);
        
        // Read current index.html to extract the title
        const currentContent = await fs.readFile(indexPath, 'utf8');
        
        // Try multiple patterns to extract title
        let title = topicId; // fallback to topicId
        
        // Pattern 1: <title>...</title>
        const titleMatch = currentContent.match(/<title>(.*?)<\/title>/i);
        if (titleMatch && titleMatch[1]) {
          title = titleMatch[1].trim();
        } else {
          // Pattern 2: Check window.$docsify.name
          const docsifyNameMatch = currentContent.match(/name:\s*['"](.+?)['"]/);
          if (docsifyNameMatch && docsifyNameMatch[1]) {
            title = docsifyNameMatch[1].trim();
          }
        }
        
        // Generate new content with extracted title
        const newContent = template.replace(/__COURSE_TITLE__/g, title);
        
        // Create backup of original file
        const backupPath = path.join(DOCS_ROOT, topicId, 'index.html.backup');
        await fs.writeFile(backupPath, currentContent, 'utf8');
        
        // Write updated file
        await fs.writeFile(indexPath, newContent, 'utf8');
        
        log(`✅ ${topicId.padEnd(6)} │ ${title}`, 'green');
        stats.updated++;
        
      } catch (err) {
        if (err.code === 'ENOENT') {
          log(`⏭️  ${topicId.padEnd(6)} │ No index.html found`, 'yellow');
          stats.skipped++;
        } else {
          log(`❌ ${topicId.padEnd(6)} │ Error: ${err.message}`, 'red');
          stats.errors++;
        }
      }
    }
    
    // Print summary
    log('\n========================================', 'cyan');
    log('📊 Migration Summary', 'bright');
    log('========================================', 'cyan');
    log(`✅ Successfully Updated: ${stats.updated}`, 'green');
    log(`⏭️  Skipped (no index):  ${stats.skipped}`, 'yellow');
    log(`❌ Errors:              ${stats.errors}`, 'red');
    log(`📁 Total Directories:   ${stats.totalDirs}`, 'blue');
    log('========================================\n', 'cyan');
    
    if (stats.updated > 0) {
      log('💾 Backup files created as: index.html.backup', 'blue');
      log('   You can restore them if needed\n', 'blue');
    }
    
    if (stats.errors === 0) {
      log('🎉 Migration completed successfully!', 'green');
    } else {
      log('⚠️  Migration completed with some errors', 'yellow');
      log('   Please check the error messages above', 'yellow');
    }
    
    process.exit(stats.errors > 0 ? 1 : 0);
    
  } catch (error) {
    log('\n❌ Fatal Error:', 'red');
    console.error(error);
    log('\n💡 Troubleshooting:', 'yellow');
    log('   1. Check if the template file exists at the correct path', 'reset');
    log('   2. Verify the docs directory path is correct', 'reset');
    log('   3. Ensure you have read/write permissions', 'reset');
    process.exit(1);
  }
}

// Handle process termination
process.on('SIGINT', () => {
  log('\n\n⚠️  Migration interrupted by user', 'yellow');
  process.exit(130);
});

// Run the migration
log('\n🚀 Starting migration...\n', 'bright');
migrateToMobileResponsive();