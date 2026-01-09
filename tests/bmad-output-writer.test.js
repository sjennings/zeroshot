/**
 * Tests for BMAD Output Writer
 * Validates file updating after cluster completion
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const BmadOutputWriter = require('../src/bmad-output-writer');

describe('BmadOutputWriter', function () {
  let tempDir;

  beforeEach(async function () {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bmad-writer-test-'));
  });

  afterEach(async function () {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  describe('updateStatus', function () {
    it('should update inline status in story', function () {
      const content = `# Story 1

Status: ready-for-dev

## Content`;

      const result = BmadOutputWriter.updateStatus(content, 'review', false);
      assert.ok(result.includes('Status: review'));
      assert.ok(!result.includes('ready-for-dev'));
    });

    it('should update frontmatter status in tech-spec', function () {
      const content = `---
title: 'Feature'
status: 'ready-for-dev'
---

# Content`;

      const result = BmadOutputWriter.updateStatus(content, 'review', true);
      assert.ok(result.includes('status: review') || result.includes("status: 'review'"));
      assert.ok(!result.includes('ready-for-dev'));
    });

    it('should preserve other frontmatter fields', function () {
      const content = `---
title: 'Feature'
slug: 'feature'
status: 'ready-for-dev'
stepsCompleted: [1, 2]
---`;

      const result = BmadOutputWriter.updateStatus(content, 'complete', true);
      assert.ok(result.includes('title:'));
      assert.ok(result.includes('slug:'));
      assert.ok(result.includes('stepsCompleted:'));
    });
  });

  describe('markTasksComplete', function () {
    it('should mark unchecked tasks as complete', function () {
      const content = `## Tasks

- [ ] Task 1
- [ ] Task 2
- [x] Already done`;

      const result = BmadOutputWriter.markTasksComplete(content);
      assert.ok(!result.includes('- [ ] Task 1'));
      assert.ok(!result.includes('- [ ] Task 2'));
      assert.ok(result.includes('- [x] Task 1'));
      assert.ok(result.includes('- [x] Task 2'));
      assert.ok(result.includes('- [x] Already done'));
    });

    it('should handle nested subtasks', function () {
      const content = `- [ ] Task 1
  - [ ] Subtask 1
  - [ ] Subtask 2`;

      const result = BmadOutputWriter.markTasksComplete(content);
      assert.ok(result.includes('- [x] Task 1'));
      assert.ok(result.includes('  - [x] Subtask 1'));
      assert.ok(result.includes('  - [x] Subtask 2'));
    });
  });

  describe('markTaskComplete', function () {
    it('should mark specific task by number', function () {
      const content = `## Tasks

- [ ] **Task 1: First**
- [ ] **Task 2: Second**
- [ ] **Task 3: Third**`;

      const result = BmadOutputWriter.markTaskComplete(content, 2);
      assert.ok(result.includes('- [ ] **Task 1:'));
      assert.ok(result.includes('- [x] **Task 2:'));
      assert.ok(result.includes('- [ ] **Task 3:'));
    });
  });

  describe('buildDevAgentRecordSection', function () {
    it('should build complete record section', function () {
      const results = {
        model: 'sonnet',
        completionNotes: ['Implemented feature X', 'Added tests'],
        filesModified: ['src/foo.js', 'tests/foo.test.js'],
        success: true,
      };

      const section = BmadOutputWriter.buildDevAgentRecordSection(results);

      assert.ok(section.includes('## Dev Agent Record'));
      assert.ok(section.includes('### Agent Model Used'));
      assert.ok(section.includes('sonnet'));
      assert.ok(section.includes('### Completion Date'));
      assert.ok(section.includes('### Completion Notes List'));
      assert.ok(section.includes('Implemented feature X'));
      assert.ok(section.includes('### File List'));
      assert.ok(section.includes('src/foo.js'));
    });

    it('should handle missing fields gracefully', function () {
      const results = {
        success: true,
      };

      const section = BmadOutputWriter.buildDevAgentRecordSection(results);

      assert.ok(section.includes('## Dev Agent Record'));
      assert.ok(section.includes('Unknown')); // Unknown model
      assert.ok(section.includes('All tasks completed successfully'));
      assert.ok(section.includes('No files recorded'));
    });

    it('should indicate failure', function () {
      const results = {
        success: false,
      };

      const section = BmadOutputWriter.buildDevAgentRecordSection(results);

      assert.ok(section.includes('did not complete successfully'));
    });
  });

  describe('fillDevAgentRecord', function () {
    it('should add section if not present', function () {
      const content = `# Story 1

## Tasks
- [x] Done`;

      const results = { model: 'sonnet', completionNotes: [], filesModified: [], success: true };
      const result = BmadOutputWriter.fillDevAgentRecord(content, results);

      assert.ok(result.includes('## Dev Agent Record'));
      assert.ok(result.includes('### Agent Model Used'));
    });

    it('should update existing section', function () {
      const content = `# Story 1

## Dev Agent Record

### Agent Model Used
(pending)

## Other Section`;

      const results = { model: 'opus', completionNotes: ['Done'], filesModified: [], success: true };
      const result = BmadOutputWriter.fillDevAgentRecord(content, results);

      assert.ok(result.includes('opus'));
      assert.ok(result.includes('Done'));
    });
  });

  describe('updateBmadFile', function () {
    it('should update story file completely', async function () {
      const storyPath = path.join(tempDir, 'story.md');
      await fs.writeFile(
        storyPath,
        `# Story 1

Status: ready-for-dev

## Tasks
- [ ] Task 1
- [ ] Task 2
`
      );

      const results = {
        model: 'sonnet',
        completionNotes: ['All done'],
        filesModified: ['src/index.js'],
        success: true,
      };

      await BmadOutputWriter.updateBmadFile(storyPath, results);

      const updated = await fs.readFile(storyPath, 'utf8');

      // Status updated
      assert.ok(updated.includes('Status: review'));
      // Tasks marked complete
      assert.ok(updated.includes('- [x] Task 1'));
      assert.ok(updated.includes('- [x] Task 2'));
      // Dev record added
      assert.ok(updated.includes('## Dev Agent Record'));
      assert.ok(updated.includes('sonnet'));
    });

    it('should update tech-spec file with frontmatter', async function () {
      const techSpecPath = path.join(tempDir, 'tech-spec.md');
      await fs.writeFile(
        techSpecPath,
        `---
title: 'Feature'
status: 'ready-for-dev'
---

# Tech-Spec

## Tasks
- [ ] Task 1
`
      );

      const results = {
        model: 'opus',
        completionNotes: [],
        filesModified: [],
        success: true,
      };

      await BmadOutputWriter.updateBmadFile(techSpecPath, results);

      const updated = await fs.readFile(techSpecPath, 'utf8');

      assert.ok(updated.includes('status: review') || updated.includes("status: 'review'"));
      assert.ok(updated.includes('- [x] Task 1'));
    });

    it('should not update status on failure', async function () {
      const storyPath = path.join(tempDir, 'story.md');
      await fs.writeFile(storyPath, `# Story\n\nStatus: ready-for-dev\n`);

      const results = { success: false };

      await BmadOutputWriter.updateBmadFile(storyPath, results);

      const updated = await fs.readFile(storyPath, 'utf8');

      assert.ok(updated.includes('Status: ready-for-dev'));
    });
  });

  describe('updateSprintStatus', function () {
    it('should update story status in sprint-status.yaml', async function () {
      const sprintPath = path.join(tempDir, 'sprint-status.yaml');
      await fs.writeFile(
        sprintPath,
        `stories:
  story-1.1: ready-for-dev
  story-1.2: in-progress
  story-1.3: draft
`
      );

      await BmadOutputWriter.updateSprintStatus(sprintPath, 'story-1.1', 'review');

      const updated = await fs.readFile(sprintPath, 'utf8');

      assert.ok(updated.includes('story-1.1: review'));
      assert.ok(updated.includes('story-1.2: in-progress'));
      assert.ok(updated.includes('story-1.3: draft'));
    });

    it('should handle story key without prefix', async function () {
      const sprintPath = path.join(tempDir, 'sprint-status.yaml');
      await fs.writeFile(
        sprintPath,
        `stories:
  story-1.1: ready-for-dev
`
      );

      await BmadOutputWriter.updateSprintStatus(sprintPath, '1.1', 'complete');

      const updated = await fs.readFile(sprintPath, 'utf8');

      assert.ok(updated.includes('story-1.1: complete'));
    });

    it('should not fail if sprint-status.yaml does not exist', async function () {
      const nonExistentPath = path.join(tempDir, 'does-not-exist.yaml');

      // Should not throw
      await BmadOutputWriter.updateSprintStatus(nonExistentPath, 'story-1', 'review');
    });
  });

  describe('extractClusterResults', function () {
    it('should return default results for null cluster', function () {
      const results = BmadOutputWriter.extractClusterResults(null);

      assert.strictEqual(results.success, false);
      assert.strictEqual(results.model, null);
      assert.deepStrictEqual(results.completionNotes, []);
      assert.deepStrictEqual(results.filesModified, []);
    });

    it('should return default results for cluster without messageBus', function () {
      const results = BmadOutputWriter.extractClusterResults({});

      assert.strictEqual(results.success, false);
    });

    it('should extract results from mock message bus', function () {
      const mockMessageBus = {
        findLast: (query) => {
          if (query.topic === 'CLUSTER_COMPLETE') {
            return { content: {} };
          }
          if (query.topic === 'IMPLEMENTATION_READY') {
            return { content: { text: 'Implementation done' } };
          }
          return null;
        },
        query: (query) => {
          if (query.topic === 'VALIDATION_RESULT') {
            return [{ content: { data: { approved: true }, text: 'Approved' } }];
          }
          if (query.topic === 'AGENT_LIFECYCLE') {
            return [{ content: { data: { model: 'sonnet' } } }];
          }
          return [];
        },
      };

      const results = BmadOutputWriter.extractClusterResults({ messageBus: mockMessageBus });

      assert.strictEqual(results.success, true);
      assert.strictEqual(results.model, 'sonnet');
      assert.ok(results.completionNotes.includes('Implementation done'));
      assert.ok(results.completionNotes.includes('Approved'));
    });
  });

  describe('markSubtaskComplete', function () {
    it('should mark specific subtask complete', function () {
      const content = `## Tasks

- [ ] **Task 1: Main task**
  - [ ] First subtask
  - [ ] Second subtask
  - [ ] Third subtask

- [ ] **Task 2: Other task**
  - [ ] Another subtask`;

      const result = BmadOutputWriter.markSubtaskComplete(content, 1, 1);

      assert.ok(result.includes('- [ ] First subtask'));
      assert.ok(result.includes('- [x] Second subtask'));
      assert.ok(result.includes('- [ ] Third subtask'));
      // Task 2 subtask should be unchanged
      assert.ok(result.includes('- [ ] Another subtask'));
    });
  });
});
