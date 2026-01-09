// POST /api/migrate/program/:programId/to-modules
router.post('/program/:programId/to-modules', verifyAdmin, async (req, res) => {
  const program = await Program.findOne({ programId: req.params.programId });
  
  // Check if already has modules
  if (program.modules && program.modules.length > 0) {
    return res.status(400).json({ error: 'Program already has modules' });
  }
  
  // Create a single module with all topics
  const moduleId = await assignNextAvailableModuleId();
  const module = new Module({
    moduleId,
    programId: program.programId,
    title: 'Main Content',
    description: 'All topics from this course',
    order: 0,
    topicIds: program.topicIds || [],
    createdBy: req.admin.email,
    lastModifiedBy: req.admin.email
  });
  
  await module.save();
  
  // Update program
  program.modules = [{ moduleId, order: 0 }];
  await program.save();
  
  res.json({ success: true, message: 'Migrated to modular structure' });
});