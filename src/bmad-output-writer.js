/**
 * BMAD Output Writer - Update BMAD files after cluster completion
 *
 * Updates:
 * - Task checkboxes (- [ ] → - [x])
 * - Dev Agent Record section
 * - Status field (inline for stories, frontmatter for tech-specs)
 * - Sprint status YAML file
 */

const fs = require('fs').promises;

/**
 * Update a BMAD file with cluster completion results
 * @param {string} filePath - Path to the BMAD file
 * @param {Object} results - Cluster completion results
 * @param {string} results.model - Model used (e.g., "sonnet")
 * @param {string[]} results.completionNotes - List of completion notes
 * @param {string[]} results.filesModified - List of files modified
 * @param {boolean} results.success - Whether cluster completed successfully
 * @returns {Promise<void>}
 */
async function updateBmadFile(filePath, results) {
  let content = await fs.readFile(filePath, 'utf8');
  const hasFrontmatter = content.trimStart().startsWith('---');

  // Update status
  if (results.success) {
    content = updateStatus(content, 'review', hasFrontmatter);
  }

  // Mark all tasks as complete if successful
  if (results.success) {
    content = markTasksComplete(content);
  }

  // Fill Dev Agent Record section
  content = fillDevAgentRecord(content, results);

  await fs.writeFile(filePath, content, 'utf8');
}

/**
 * Update status field
 * @param {string} content - File content
 * @param {string} newStatus - New status value
 * @param {boolean} hasFrontmatter - Whether file has YAML frontmatter
 * @returns {string} Updated content
 */
function updateStatus(content, newStatus, hasFrontmatter) {
  if (hasFrontmatter) {
    // Update YAML frontmatter status
    return content.replace(
      /^(---[\s\S]*?)(status:\s*['"]?)([^'"\n]+)(['"]?)([\s\S]*?---)/m,
      `$1$2${newStatus}$4$5`
    );
  } else {
    // Update inline status
    return content.replace(/^(Status:\s*)(.+)$/im, `$1${newStatus}`);
  }
}

/**
 * Mark all task checkboxes as complete
 * @param {string} content - File content
 * @returns {string} Updated content
 */
function markTasksComplete(content) {
  // Match task checkboxes: - [ ] → - [x]
  // Handle both top-level and nested tasks
  return content.replace(/^(\s*-\s+)\[\s\]/gm, '$1[x]');
}

/**
 * Fill the Dev Agent Record section
 * @param {string} content - File content
 * @param {Object} results - Cluster results
 * @returns {string} Updated content
 */
function fillDevAgentRecord(content, results) {
  // Check if Dev Agent Record section exists
  const hasDevAgentRecord = content.includes('## Dev Agent Record');

  if (!hasDevAgentRecord) {
    // Add section at the end
    const recordSection = buildDevAgentRecordSection(results);
    return content.trimEnd() + '\n\n' + recordSection;
  }

  // Update existing section
  // Find the section and replace its content
  const sectionPattern = /(## Dev Agent Record[\s\S]*?)(?=\n## [A-Z]|\n$|$)/i;
  const match = content.match(sectionPattern);

  if (match) {
    const recordSection = buildDevAgentRecordSection(results);
    return content.replace(sectionPattern, recordSection + '\n');
  }

  return content;
}

/**
 * Build Dev Agent Record section content
 * @param {Object} results - Cluster results
 * @returns {string} Section content
 */
function buildDevAgentRecordSection(results) {
  const timestamp = new Date().toISOString().split('T')[0];
  let section = `## Dev Agent Record\n\n`;

  section += `### Agent Model Used\n`;
  section += `${results.model || 'Unknown'}\n\n`;

  section += `### Completion Date\n`;
  section += `${timestamp}\n\n`;

  section += `### Completion Notes List\n`;
  if (results.completionNotes && results.completionNotes.length > 0) {
    for (const note of results.completionNotes) {
      section += `- ${note}\n`;
    }
  } else if (results.success) {
    section += `- All tasks completed successfully\n`;
  } else {
    section += `- Cluster did not complete successfully\n`;
  }
  section += '\n';

  section += `### File List\n`;
  if (results.filesModified && results.filesModified.length > 0) {
    for (const file of results.filesModified) {
      section += `- ${file}\n`;
    }
  } else {
    section += `- No files recorded\n`;
  }

  return section;
}

/**
 * Update sprint-status.yaml with story status change
 * @param {string} sprintStatusPath - Path to sprint-status.yaml
 * @param {string} storyKey - Story identifier (e.g., "1.2" or "story-1.2")
 * @param {string} newStatus - New status value
 * @returns {Promise<void>}
 */
async function updateSprintStatus(sprintStatusPath, storyKey, newStatus) {
  try {
    let content = await fs.readFile(sprintStatusPath, 'utf8');

    // Normalize story key (remove "story-" prefix if present)
    const normalizedKey = storyKey.replace(/^story[-_]?/i, '');

    // Find and update the story status
    // Format: story-X.Y: ready-for-dev  or  "1.2": ready-for-dev
    const patterns = [
      new RegExp(`^(\\s*story[-_]?${escapeRegex(normalizedKey)}\\s*:\\s*)([^\\n]+)`, 'im'),
      new RegExp(`^(\\s*['"]?${escapeRegex(normalizedKey)}['"]?\\s*:\\s*)([^\\n]+)`, 'im'),
    ];

    let updated = false;
    for (const pattern of patterns) {
      if (pattern.test(content)) {
        content = content.replace(pattern, `$1${newStatus}`);
        updated = true;
        break;
      }
    }

    if (updated) {
      await fs.writeFile(sprintStatusPath, content, 'utf8');
    }
  } catch (err) {
    // Sprint status file may not exist - that's okay
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }
}

/**
 * Escape special regex characters
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extract cluster results from messages
 * @param {Object} cluster - Cluster object with messageBus
 * @returns {Object} Extracted results
 */
function extractClusterResults(cluster) {
  const results = {
    success: false,
    model: null,
    completionNotes: [],
    filesModified: [],
  };

  if (!cluster || !cluster.messageBus) {
    return results;
  }

  const ledger = cluster.messageBus;

  // Find CLUSTER_COMPLETE message
  const completeMsg = ledger.findLast({ topic: 'CLUSTER_COMPLETE' });
  if (completeMsg) {
    results.success = true;
  }

  // Find IMPLEMENTATION_READY for completion notes
  const implMsg = ledger.findLast({ topic: 'IMPLEMENTATION_READY' });
  if (implMsg) {
    if (implMsg.content?.text) {
      results.completionNotes.push(implMsg.content.text);
    }
  }

  // Find VALIDATION_RESULT messages for additional notes
  const validationMsgs = ledger.query({ topic: 'VALIDATION_RESULT' });
  for (const msg of validationMsgs || []) {
    if (msg.content?.data?.approved) {
      results.success = true;
    }
    if (msg.content?.text) {
      results.completionNotes.push(msg.content.text);
    }
  }

  // Get model from agent lifecycle messages
  const lifecycleMsgs = ledger.query({ topic: 'AGENT_LIFECYCLE' });
  for (const msg of lifecycleMsgs || []) {
    if (msg.content?.data?.model) {
      results.model = msg.content.data.model;
      break;
    }
  }

  // Try to find files modified from agent output
  // This would require parsing the agent's actual output which may vary
  // For now, we'll leave this empty and let the caller provide it if needed

  return results;
}

/**
 * Update specific task checkbox by task number
 * @param {string} content - File content
 * @param {number} taskNum - Task number to mark complete
 * @returns {string} Updated content
 */
function markTaskComplete(content, taskNum) {
  // Match: - [ ] **Task N:** or - [ ] **Task N :**
  const pattern = new RegExp(
    `^(\\s*-\\s+)\\[\\s\\](\\s+\\*\\*Task\\s*${taskNum}\\s*:)`,
    'im'
  );
  return content.replace(pattern, '$1[x]$2');
}

/**
 * Update specific subtask checkbox under a task
 * @param {string} content - File content
 * @param {number} taskNum - Parent task number
 * @param {number} subtaskIndex - 0-based subtask index
 * @returns {string} Updated content
 */
function markSubtaskComplete(content, taskNum, subtaskIndex) {
  // Find the task section and count subtasks
  const lines = content.split('\n');
  let inTask = false;
  let subtaskCount = 0;
  let modified = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check if we're entering the target task
    const taskMatch = line.match(/^-\s+\[[ x]\]\s+\*\*Task\s*(\d+)/i);
    if (taskMatch) {
      inTask = parseInt(taskMatch[1], 10) === taskNum;
      subtaskCount = 0;
      continue;
    }

    // Check for subtask in current task
    if (inTask && line.match(/^\s+-\s+\[\s\]/)) {
      if (subtaskCount === subtaskIndex) {
        lines[i] = line.replace(/\[\s\]/, '[x]');
        modified = true;
        break;
      }
      subtaskCount++;
    }

    // Exit task section on next top-level item
    if (inTask && line.match(/^-\s+\[/) && !line.match(/^\s+-/)) {
      inTask = false;
    }
  }

  return modified ? lines.join('\n') : content;
}

module.exports = {
  updateBmadFile,
  updateStatus,
  markTasksComplete,
  markTaskComplete,
  markSubtaskComplete,
  fillDevAgentRecord,
  buildDevAgentRecordSection,
  updateSprintStatus,
  extractClusterResults,
};
