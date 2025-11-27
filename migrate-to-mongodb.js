require("dotenv").config();
const mongoose = require("mongoose");
const fs = require("fs").promises;
const path = require("path");
const Course = require("./models/Course");

async function migrate() {
  try {
    console.log("🔄 Starting migration to MongoDB...");

    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ Connected to MongoDB");

    // Read index.json
    const indexPath = path.join(__dirname, "../client/public/docs/index.json");
    const indexContent = await fs.readFile(indexPath, "utf-8");
    const courses = JSON.parse(indexContent);

    console.log(`📚 Found ${courses.length} courses to migrate`);

    let migrated = 0;
    let skipped = 0;
    let errors = 0;

    for (const course of courses) {
      try {
        // Check if course already exists
        const existing = await Course.findOne({ projectId: course.proj });

        if (existing) {
          console.log(`⏭️  Skipping ${course.proj} (already exists)`);
          skipped++;
          continue;
        }

        // Read course files
        const courseDir = path.join(
          __dirname,
          "../client/public/docs",
          course.proj
        );

        let readmeContent = "";
        let sidebarContent = "";
        let indexHtmlContent = "";

        try {
          readmeContent = await fs.readFile(
            path.join(courseDir, "README.md"),
            "utf-8"
          );
        } catch (err) {
          readmeContent = `# ${course.title}\n\nStart writing your course content here...`;
        }

        try {
          sidebarContent = await fs.readFile(
            path.join(courseDir, "_sidebar.md"),
            "utf-8"
          );
        } catch (err) {
          sidebarContent = "* [Home](README.md)";
        }

        try {
          indexHtmlContent = await fs.readFile(
            path.join(courseDir, "index.html"),
            "utf-8"
          );
        } catch (err) {
          indexHtmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${course.title}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="//cdn.jsdelivr.net/npm/docsify@4/lib/themes/vue.css">
</head>
<body>
  <div id="app">Loading...</div>
  <script>
    window.$docsify = {
      name: '${course.title}',
      repo: '',
      loadSidebar: true,
      subMaxLevel: 2,
      loadNavbar: false,
      copyCode: {
        buttonText: '📋 Copy',
        errorText: '✖ Failed',
        successText: '✓ Copied!'
      },
    };
  </script>
  <script src="//cdn.jsdelivr.net/npm/docsify@4"></script>
  <script src="//cdn.jsdelivr.net/npm/docsify-copy-code"></script>
</body>
</html>`;
        }

        // Create course in MongoDB
        const newCourse = new Course({
          projectId: course.proj,
          title: course.title || course.proj,
          description: course.description || "",
          keywords: Array.isArray(course.keywords)
            ? course.keywords
            : course.keywords
            ? course.keywords.split(",").map((k) => k.trim())
            : [],
          readmeContent,
          sidebarContent,
          indexHtmlContent,
          createdBy: course.createdBy || "admin@system.com",
          createdAt: course.createdAt ? new Date(course.createdAt) : new Date(),
          lastModifiedBy:
            course.lastModifiedBy || course.createdBy || "admin@system.com",
          lastModifiedAt: course.lastModifiedAt
            ? new Date(course.lastModifiedAt)
            : new Date(),
          collaborators: course.collaborators || [],
          filesSynced: true,
          lastSyncedAt: new Date(),
        });

        await newCourse.save();
        console.log(`✅ Migrated: ${course.proj}`);
        migrated++;
      } catch (err) {
        console.error(`❌ Error migrating ${course.proj}:`, err.message);
        errors++;
      }
    }

    console.log("\n📊 Migration Summary:");
    console.log(`✅ Migrated: ${migrated}`);
    console.log(`⏭️  Skipped: ${skipped}`);
    console.log(`❌ Errors: ${errors}`);
    console.log(`📚 Total: ${courses.length}`);

    // Backup index.json
    const backupPath = path.join(
      __dirname,
      "../client/public/docs/index.json.backup"
    );
    await fs.copyFile(indexPath, backupPath);
    console.log(`\n💾 Backup created: index.json.backup`);

    console.log("\n✅ Migration completed successfully!");

    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  }
}

migrate();
