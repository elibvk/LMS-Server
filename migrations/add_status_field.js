// server/migrations/add_status_field.js
// CORRECTED VERSION - Sets existing topics to "published"
require('dotenv').config();
const mongoose = require('mongoose');

const courseSchema = new mongoose.Schema({
  projectId: String,
  status: String,
  title: String
}, { collection: 'courses' });

const Course = mongoose.model('Course', courseSchema);

async function migrate() {
  try {
    console.log('🔧 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
    
    console.log('✅ Connected to database');
    
    // Count topics without status field
    const topicsWithoutStatus = await Course.countDocuments({ 
      status: { $exists: false } 
    });
    
    console.log(`📝 Found ${topicsWithoutStatus} topics without status field`);
    
    if (topicsWithoutStatus === 0) {
      console.log('✨ All topics already have status field. Nothing to do.');
      process.exit(0);
    }
    
    // ⭐ Set EXISTING topics to "published" (they were already live)
    // Only NEW topics from now on will default to "draft"
    const result = await Course.updateMany(
      { status: { $exists: false } },
      { $set: { status: 'published' } }
    );
    
    console.log(`✅ Added status field to ${result.modifiedCount} topics`);
    console.log(`📢 All existing topics set to "published" (they were already live)`);
    console.log(`💡 New topics will default to "draft" as per model schema`);
    
    // Verify the update
    const publishedCount = await Course.countDocuments({ status: 'published' });
    const draftCount = await Course.countDocuments({ status: 'draft' });
    
    console.log(`\n📊 Current Status:`);
    console.log(`   ✓ Published: ${publishedCount}`);
    console.log(`   📝 Drafts: ${draftCount}`);
    
    console.log('\n✨ Migration complete!');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

migrate();