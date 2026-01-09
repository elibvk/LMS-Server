// server/migrations/fix_existing_topics.js
// This script sets all existing topics to "published" status

const mongoose = require('mongoose');
require('dotenv').config();

const courseSchema = new mongoose.Schema({
  projectId: String,
  status: String,
  title: String
}, { collection: 'courses' });

const Course = mongoose.model('Course', courseSchema);

async function fixExistingTopics() {
  try {
    console.log('🔧 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
    
    console.log('✅ Connected to database');
    
    // Count topics before update
    const draftCount = await Course.countDocuments({ status: 'draft' });
    console.log(`📝 Found ${draftCount} topics with "draft" status`);
    
    // Update all existing topics to "published"
    const result = await Course.updateMany(
      { status: 'draft' }, // Find all drafts
      { $set: { status: 'published' } } // Set to published
    );
    
    console.log(`✅ Updated ${result.modifiedCount} topics to "published" status`);
    
    // Verify the update
    const publishedCount = await Course.countDocuments({ status: 'published' });
    const remainingDrafts = await Course.countDocuments({ status: 'draft' });
    
    console.log(`\n📊 Final Status:`);
    console.log(`   ✓ Published: ${publishedCount}`);
    console.log(`   📝 Drafts: ${remainingDrafts}`);
    
    console.log('\n✨ Migration complete! All existing topics are now published.');
    console.log('💡 New topics created from now on will default to "draft" status.');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

fixExistingTopics();