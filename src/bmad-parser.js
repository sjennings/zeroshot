/**
 * BMAD Parser - Parse BMAD story and tech-spec files
 *
 * Extracts structured data from BMAD artifacts:
 * - Stories: No YAML frontmatter, inline Status, Given/When/Then ACs
 * - Tech-specs: YAML frontmatter, markdown sections
 */

const fs = require('fs').promises;
const path = require('path');

/**
 * Parse a BMAD file (story or tech-spec)
 * @param {string} filePath - Path to the BMAD file
 * @returns {Promise<Object>} Parsed BMAD data
 */
async function parseBmadFile(filePath) {
  const content = await fs.readFile(filePath, 'utf8');
  const absolutePath = path.resolve(filePath);

  // Detect file type based on frontmatter presence
  const hasFrontmatter = content.trimStart().startsWith('---');

  if (hasFrontmatter) {
    return parseTechSpec(content, absolutePath);
  } else {
    return parseStory(content, absolutePath);
  }
}

/**
 * Parse a tech-spec file with YAML frontmatter
 * @param {string} content - File content
 * @param {string} filePath - Absolute path to file
 * @returns {Object} Parsed tech-spec data
 */
function parseTechSpec(content, filePath) {
  const frontmatter = extractFrontmatter(content);
  const markdown = content.replace(/^---[\s\S]*?---\n?/, '');

  // Extract title from first h1 heading
  const titleMatch = markdown.match(/^#\s+(?:Tech-Spec:\s*)?(.+)$/m);
  const title = frontmatter.title || (titleMatch ? titleMatch[1].trim() : 'Untitled');

  // Parse sections
  const acceptanceCriteria = extractAcceptanceCriteria(markdown);
  const tasks = extractTasks(markdown);
  const devNotes = extractDevNotes(markdown);
  const fileRefs = extractFileRefs(markdown);

  return {
    type: 'tech-spec',
    filePath,
    title,
    slug: frontmatter.slug || null,
    status: frontmatter.status || 'unknown',
    stepsCompleted: frontmatter.stepsCompleted || [],
    techStack: frontmatter.tech_stack || [],
    filesToModify: frontmatter.files_to_modify || [],
    codePatterns: frontmatter.code_patterns || [],
    testPatterns: frontmatter.test_patterns || [],
    acceptanceCriteria,
    tasks,
    devNotes,
    fileRefs,
    raw: {
      frontmatter,
      markdown,
    },
  };
}

/**
 * Parse a story file (no YAML frontmatter)
 * @param {string} content - File content
 * @param {string} filePath - Absolute path to file
 * @returns {Object} Parsed story data
 */
function parseStory(content, filePath) {
  // Extract title from first h1 heading
  const titleMatch = content.match(/^#\s+(?:Story\s+[\d.]+:\s*)?(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : 'Untitled Story';

  // Extract inline status (Status: ready-for-dev)
  const statusMatch = content.match(/^Status:\s*(.+)$/im);
  const status = statusMatch ? statusMatch[1].trim() : 'unknown';

  // Parse sections
  const storyStatement = extractStoryStatement(content);
  const acceptanceCriteria = extractAcceptanceCriteria(content);
  const tasks = extractTasks(content);
  const devNotes = extractDevNotes(content);
  const fileRefs = extractFileRefs(content);

  return {
    type: 'story',
    filePath,
    title,
    status,
    storyStatement,
    acceptanceCriteria,
    tasks,
    devNotes,
    fileRefs,
    raw: {
      content,
    },
  };
}

/**
 * Extract YAML frontmatter from content
 * @param {string} content - File content
 * @returns {Object} Parsed frontmatter
 */
function extractFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};

  const yaml = match[1];
  const result = {};

  // Simple YAML parsing (single-level key-value and arrays)
  const lines = yaml.split('\n');
  let currentKey = null;
  let inArray = false;

  for (const line of lines) {
    // Skip empty lines
    if (!line.trim()) continue;

    // Check for array item (indented with -)
    if (line.match(/^\s+-\s+/)) {
      if (currentKey && inArray) {
        const value = line.replace(/^\s+-\s+/, '').trim();
        // Remove outer quotes if present (handles 'value' or "value")
        const cleanValue = stripOuterQuotes(value);
        result[currentKey].push(cleanValue);
      }
      continue;
    }

    // Check for key-value pair - handle quoted values containing colons
    // Match: key: value OR key: 'value with: colon' OR key: "value with: colon"
    const kvMatch = line.match(/^(\w+):\s*(.*)$/);
    if (kvMatch) {
      const [, key, rawValue] = kvMatch;
      let value = rawValue.trim();

      // Check if this starts an array (empty value or empty brackets)
      if (value === '' || value === '[]') {
        result[key] = [];
        currentKey = key;
        inArray = true;
        continue;
      }

      // Check for inline array [item1, item2] - parse carefully to handle quoted items
      if (value.startsWith('[') && value.endsWith(']')) {
        const items = parseInlineArray(value);
        result[key] = items;
        currentKey = key;
        inArray = false;
        continue;
      }

      // Remove outer quotes if present (preserves content including colons)
      value = stripOuterQuotes(value);

      result[key] = value;
      currentKey = key;
      inArray = false;
    }
  }

  return result;
}

/**
 * Strip outer quotes from a string (single or double)
 * @param {string} str - String to process
 * @returns {string} String without outer quotes
 */
function stripOuterQuotes(str) {
  if ((str.startsWith("'") && str.endsWith("'")) || (str.startsWith('"') && str.endsWith('"'))) {
    return str.slice(1, -1);
  }
  return str;
}

/**
 * Parse an inline YAML array like [item1, 'item 2', "item 3"]
 * Handles quoted items that may contain commas
 * @param {string} arrayStr - The array string including brackets
 * @returns {string[]} Parsed array items
 */
function parseInlineArray(arrayStr) {
  const inner = arrayStr.slice(1, -1).trim();
  if (!inner) return [];

  const items = [];
  let current = '';
  let inQuote = null;

  for (let i = 0; i < inner.length; i++) {
    const char = inner[i];

    if (inQuote) {
      if (char === inQuote) {
        inQuote = null;
      }
      current += char;
    } else if (char === "'" || char === '"') {
      inQuote = char;
      current += char;
    } else if (char === ',') {
      const trimmed = stripOuterQuotes(current.trim());
      if (trimmed) items.push(trimmed);
      current = '';
    } else {
      current += char;
    }
  }

  // Don't forget the last item
  const trimmed = stripOuterQuotes(current.trim());
  if (trimmed) items.push(trimmed);

  return items;
}

/**
 * Extract story statement (As a... I want... So that...)
 * @param {string} content - Markdown content
 * @returns {string|null} Story statement
 */
function extractStoryStatement(content) {
  // Find ## Story section
  const sectionMatch = content.match(/##\s+Story\s*\n([\s\S]*?)(?=\n##|\n$|$)/i);
  if (!sectionMatch) return null;

  const section = sectionMatch[1].trim();
  // Look for "As a... I want... So that..." pattern
  const storyMatch = section.match(/As\s+a\s+.+?,\s*I\s+want\s+.+?,\s*so\s+that\s+.+/i);
  return storyMatch ? storyMatch[0].trim() : section;
}

/**
 * Extract acceptance criteria from markdown
 * @param {string} content - Markdown content
 * @returns {Array<Object>} Structured acceptance criteria
 */
function extractAcceptanceCriteria(content) {
  const criteria = [];

  // Find ## Acceptance Criteria section
  const sectionMatch = content.match(
    /##\s+Acceptance\s+Criteria\s*\n([\s\S]*?)(?=\n##(?:\s+[A-Z]|\s*$)|\n$|$)/i
  );
  if (!sectionMatch) {
    // Try finding numbered AC list in Tasks section
    return extractNumberedACs(content);
  }

  const section = sectionMatch[1];

  // Parse Given/When/Then format
  const gwtPattern = /\*\*Given\*\*\s+(.+?)\s*\n\*\*When\*\*\s+(.+?)\s*\n\*\*Then\*\*\s+(.+?)(?=\n\*\*Given\*\*|\n##|\n$|$)/gis;
  let match;
  let index = 1;

  while ((match = gwtPattern.exec(section)) !== null) {
    criteria.push({
      id: index++,
      type: 'gherkin',
      given: match[1].trim(),
      when: match[2].trim(),
      then: match[3].trim(),
      raw: match[0].trim(),
    });
  }

  // If no Given/When/Then, try checkbox format
  if (criteria.length === 0) {
    const checkboxPattern = /^-\s+\[[ x]\]\s+\*\*AC\s*(\d+)\*\*:?\s*(.+)$/gim;
    while ((match = checkboxPattern.exec(section)) !== null) {
      criteria.push({
        id: parseInt(match[1], 10),
        type: 'checkbox',
        description: match[2].trim(),
        raw: match[0].trim(),
      });
    }
  }

  // Try bullet point format (no checkbox)
  if (criteria.length === 0) {
    const bulletPattern = /^-\s+(.+)$/gm;
    while ((match = bulletPattern.exec(section)) !== null) {
      criteria.push({
        id: index++,
        type: 'bullet',
        description: match[1].trim(),
        raw: match[0].trim(),
      });
    }
  }

  return criteria;
}

/**
 * Extract numbered ACs from Implementation Plan/Tasks section
 * @param {string} content - Markdown content
 * @returns {Array<Object>} Structured acceptance criteria
 */
function extractNumberedACs(content) {
  const criteria = [];

  // Look for AC references in the format "- [ ] **AC 1**:" or similar
  const acPattern = /^-\s+\[[ x]\]\s+\*\*AC\s*(\d+)\*\*:?\s*(.+)$/gim;
  let match;

  while ((match = acPattern.exec(content)) !== null) {
    criteria.push({
      id: parseInt(match[1], 10),
      type: 'checkbox',
      description: match[2].trim(),
      checked: match[0].includes('[x]'),
      raw: match[0].trim(),
    });
  }

  return criteria;
}

/**
 * Extract tasks and subtasks from markdown
 * @param {string} content - Markdown content
 * @returns {Array<Object>} Structured tasks
 */
function extractTasks(content) {
  const tasks = [];

  // Find Tasks section - handle variations:
  // - ## Tasks
  // - ## Tasks / Subtasks
  // - ### Tasks (under ## Implementation Plan)
  const sectionMatch = content.match(
    /(?:##\s+Tasks(?:\s*\/\s*Subtasks)?|###\s+Tasks|##\s+Implementation\s+Plan[\s\S]*?###\s+Tasks)\s*\n([\s\S]*?)(?=\n##(?:\s+[A-Z]|\s*$)|\n$|$)/i
  );
  if (!sectionMatch) return tasks;

  const section = sectionMatch[1];
  const lines = section.split('\n');

  let currentTask = null;

  for (const line of lines) {
    // Top-level task: "- [ ] **Task N: Description**" or "- [ ] Task Description"
    const taskMatch = line.match(
      /^-\s+\[([x ])\]\s+\*\*Task\s*(\d+):?\s*(.+?)\*\*|^-\s+\[([x ])\]\s+\*\*(.+?)\*\*/i
    );
    if (taskMatch) {
      const checked = (taskMatch[1] || taskMatch[4]) === 'x';
      const taskNum = taskMatch[2] ? parseInt(taskMatch[2], 10) : tasks.length + 1;
      const title = (taskMatch[3] || taskMatch[5]).trim();

      currentTask = {
        id: taskNum,
        title,
        checked,
        subtasks: [],
        details: [],
        raw: line,
      };
      tasks.push(currentTask);
      continue;
    }

    // Subtask: "  - [ ] Subtask" (indented)
    const subtaskMatch = line.match(/^\s+-\s+\[([x ])\]\s+(.+)$/);
    if (subtaskMatch && currentTask) {
      currentTask.subtasks.push({
        title: subtaskMatch[2].trim(),
        checked: subtaskMatch[1] === 'x',
        raw: line,
      });
      continue;
    }

    // Task detail lines (File:, Action:, Details:)
    const detailMatch = line.match(/^\s+-\s+(\w+):\s*(.+)$/);
    if (detailMatch && currentTask) {
      currentTask.details.push({
        key: detailMatch[1].trim(),
        value: detailMatch[2].trim(),
      });
      continue;
    }

    // Code block or other content under current task
    if (currentTask && line.trim() && !line.match(/^-\s+\[/)) {
      // Skip for now - can be enhanced to capture code examples
    }
  }

  return tasks;
}

/**
 * Extract dev notes section
 * @param {string} content - Markdown content
 * @returns {string|null} Dev notes content
 */
function extractDevNotes(content) {
  // Try various section names
  const patterns = [
    /##\s+Dev\s+Notes?\s*\n([\s\S]*?)(?=\n##(?:\s+[A-Z]|\s*$)|\n$|$)/i,
    /##\s+Additional\s+Context\s*\n([\s\S]*?)(?=\n##(?:\s+[A-Z]|\s*$)|\n$|$)/i,
    /##\s+Notes?\s*\n([\s\S]*?)(?=\n##(?:\s+[A-Z]|\s*$)|\n$|$)/i,
  ];

  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }

  return null;
}

/**
 * Extract file references from content
 * @param {string} content - Markdown content
 * @returns {Array<string>} File paths referenced
 */
function extractFileRefs(content) {
  const refs = new Set();

  // Match file paths in various formats:
  // - backtick: `src/file.js`
  // - File: src/file.js
  // - (src/file.js)
  // - src/file.js:123

  // Backtick paths
  const backtickPattern = /`([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+(?::\d+)?)`/g;
  let match;
  while ((match = backtickPattern.exec(content)) !== null) {
    const filePath = match[1].split(':')[0]; // Remove line number
    refs.add(filePath);
  }

  // File: prefix
  const filePattern = /File:\s*`?([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)`?/gi;
  while ((match = filePattern.exec(content)) !== null) {
    refs.add(match[1]);
  }

  // files_to_modify entries in frontmatter style
  const ftmPattern = /^\s+-\s+([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)/gm;
  while ((match = ftmPattern.exec(content)) !== null) {
    // Skip if it looks like a task description
    if (!match[1].includes(' ')) {
      refs.add(match[1]);
    }
  }

  return Array.from(refs);
}

/**
 * Convert parsed BMAD data to standard inputData format
 * @param {Object} bmadData - Parsed BMAD data
 * @returns {Object} Standard inputData format for ISSUE_OPENED
 */
function toInputData(bmadData) {
  // Build context string with structured sections
  let context = `# ${bmadData.type === 'tech-spec' ? 'Tech-Spec' : 'Story'}: ${bmadData.title}\n\n`;

  if (bmadData.storyStatement) {
    context += `## Story\n${bmadData.storyStatement}\n\n`;
  }

  // Acceptance Criteria
  if (bmadData.acceptanceCriteria.length > 0) {
    context += `## Acceptance Criteria\n\n`;
    for (const ac of bmadData.acceptanceCriteria) {
      if (ac.type === 'gherkin') {
        context += `### AC ${ac.id}\n`;
        context += `**Given** ${ac.given}\n`;
        context += `**When** ${ac.when}\n`;
        context += `**Then** ${ac.then}\n\n`;
      } else {
        context += `- [ ] **AC ${ac.id}**: ${ac.description}\n`;
      }
    }
    context += '\n';
  }

  // Tasks
  if (bmadData.tasks.length > 0) {
    context += `## Tasks\n\n`;
    for (const task of bmadData.tasks) {
      context += `- [ ] **Task ${task.id}**: ${task.title}\n`;
      for (const detail of task.details || []) {
        context += `  - ${detail.key}: ${detail.value}\n`;
      }
      for (const subtask of task.subtasks || []) {
        context += `  - [ ] ${subtask.title}\n`;
      }
    }
    context += '\n';
  }

  // Dev Notes
  if (bmadData.devNotes) {
    context += `## Dev Notes\n\n${bmadData.devNotes}\n\n`;
  }

  // File References
  if (bmadData.fileRefs.length > 0) {
    context += `## Files Referenced\n\n`;
    for (const ref of bmadData.fileRefs) {
      context += `- \`${ref}\`\n`;
    }
    context += '\n';
  }

  return {
    number: null,
    title: bmadData.title,
    body: context,
    labels: [],
    comments: [],
    url: null,
    context,
  };
}

/**
 * Scan directory for ready-for-dev BMAD files
 * @param {string} dirPath - Directory to scan
 * @returns {Promise<Array<string>>} File paths sorted by priority
 */
async function findReadyStories(dirPath) {
  const results = [];
  const absoluteDir = path.resolve(dirPath);

  async function scanDir(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // Skip hidden directories and node_modules
        if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
          await scanDir(fullPath);
        }
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        try {
          const content = await fs.readFile(fullPath, 'utf8');

          // Check for ready-for-dev status
          // YAML frontmatter: status: 'ready-for-dev'
          // Inline: Status: ready-for-dev
          const hasFrontmatterStatus = content.match(/^---[\s\S]*?status:\s*['"]?ready-for-dev['"]?[\s\S]*?---/m);
          const hasInlineStatus = content.match(/^Status:\s*ready-for-dev/im);

          if (hasFrontmatterStatus || hasInlineStatus) {
            results.push(fullPath);
          }
        } catch {
          // Skip files that can't be read
        }
      }
    }
  }

  await scanDir(absoluteDir);

  // Sort by filename (stories are typically numbered like story-1.1.md)
  results.sort((a, b) => path.basename(a).localeCompare(path.basename(b)));

  return results;
}

/**
 * Check if a file path looks like a BMAD file
 * @param {string} filePath - Path to check
 * @returns {boolean} True if likely a BMAD file
 */
function isBmadFile(filePath) {
  if (!filePath.endsWith('.md')) return false;

  const basename = path.basename(filePath).toLowerCase();
  return (
    basename.includes('story') ||
    basename.includes('tech-spec') ||
    basename.includes('techspec') ||
    basename.startsWith('story-') ||
    basename.startsWith('tech-spec-')
  );
}

/**
 * Validate that a file is a valid BMAD artifact
 * @param {string} filePath - Path to file
 * @returns {Promise<{valid: boolean, error?: string}>}
 */
async function validateBmadFile(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf8');

    // Must have some content
    if (!content.trim()) {
      return { valid: false, error: 'File is empty' };
    }

    // Check for required sections
    const hasTitle = content.match(/^#\s+.+$/m);
    if (!hasTitle) {
      return { valid: false, error: 'Missing title (# heading)' };
    }

    // For tech-specs, validate frontmatter
    if (content.trimStart().startsWith('---')) {
      const frontmatterEnd = content.indexOf('---', 4);
      if (frontmatterEnd === -1) {
        return { valid: false, error: 'Malformed frontmatter (missing closing ---)' };
      }

      const frontmatter = extractFrontmatter(content);
      if (!frontmatter.status) {
        return { valid: false, error: 'Missing status in frontmatter' };
      }
    } else {
      // For stories, must have inline status
      const hasStatus = content.match(/^Status:\s*.+$/im);
      if (!hasStatus) {
        return { valid: false, error: 'Missing Status: line' };
      }
    }

    return { valid: true };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

/**
 * Format tasks as markdown string for template substitution
 * @param {Array<Object>} tasks - Parsed tasks from BMAD file
 * @returns {string} Formatted markdown string
 */
function formatTasksForTemplate(tasks) {
  if (!tasks || tasks.length === 0) {
    return '(No tasks defined)';
  }

  let result = '';
  for (const task of tasks) {
    result += `- [ ] **Task ${task.id}**: ${task.title}\n`;
    for (const detail of task.details || []) {
      result += `  - ${detail.key}: ${detail.value}\n`;
    }
    for (const subtask of task.subtasks || []) {
      result += `  - [ ] ${subtask.title}\n`;
    }
  }
  return result.trim();
}

/**
 * Format acceptance criteria as markdown string for template substitution
 * @param {Array<Object>} criteria - Parsed acceptance criteria from BMAD file
 * @returns {string} Formatted markdown string
 */
function formatAcceptanceCriteriaForTemplate(criteria) {
  if (!criteria || criteria.length === 0) {
    return '(No acceptance criteria defined)';
  }

  let result = '';
  for (const ac of criteria) {
    if (ac.type === 'gherkin') {
      result += `### AC ${ac.id}\n`;
      result += `**Given** ${ac.given}\n`;
      result += `**When** ${ac.when}\n`;
      result += `**Then** ${ac.then}\n\n`;
    } else {
      result += `### AC ${ac.id}\n`;
      result += `${ac.description}\n\n`;
    }
  }
  return result.trim();
}

/**
 * Format file references as markdown string for template substitution
 * @param {Array<string>} refs - File paths referenced
 * @returns {string} Formatted markdown string
 */
function formatFileRefsForTemplate(refs) {
  if (!refs || refs.length === 0) {
    return '(No files referenced)';
  }

  return refs.map((ref) => `- \`${ref}\``).join('\n');
}

module.exports = {
  parseBmadFile,
  parseTechSpec,
  parseStory,
  extractFrontmatter,
  extractAcceptanceCriteria,
  extractTasks,
  extractDevNotes,
  extractFileRefs,
  toInputData,
  findReadyStories,
  isBmadFile,
  validateBmadFile,
  formatTasksForTemplate,
  formatAcceptanceCriteriaForTemplate,
  formatFileRefsForTemplate,
};
