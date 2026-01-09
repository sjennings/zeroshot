/**
 * Integration tests for BMAD input flow
 *
 * Tests the complete flow:
 * 1. Parse BMAD file (story or tech-spec)
 * 2. Bypass conductor classification
 * 3. Load bmad-workflow template
 * 4. Execute worker with structured context
 * 5. Validate with AC checklist
 * 6. Update BMAD file on completion
 */

const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const Orchestrator = require('../../src/orchestrator');
const MockTaskRunner = require('../helpers/mock-task-runner');
const BmadParser = require('../../src/bmad-parser');

describe('BMAD Input Flow Integration', function () {
  this.timeout(30000);

  let tempDir;
  let orchestrator;
  let mockRunner;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeroshot-bmad-integration-'));
    mockRunner = new MockTaskRunner();
  });

  afterEach(async () => {
    if (orchestrator) {
      const clusters = orchestrator.listClusters();
      for (const cluster of clusters) {
        try {
          await orchestrator.kill(cluster.id);
        } catch {
          // Ignore cleanup errors
        }
      }
    }
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('BMAD Parser Integration', function () {
    it('should parse tech-spec and extract structured data', async function () {
      const techSpecContent = `---
title: 'Add Login Feature'
slug: 'add-login'
status: 'ready-for-dev'
stepsCompleted: [1, 2, 3]
files_to_modify:
  - src/auth.js
  - tests/auth.test.js
---

# Tech-Spec: Add Login Feature

## Overview
Add user authentication to the application.

## Acceptance Criteria

- [ ] **AC 1**: User can log in with email and password
- [ ] **AC 2**: Invalid credentials show error message

## Implementation Plan

### Tasks

- [ ] **Task 1: Create auth module**
  - File: src/auth.js
  - [ ] Add login function
  - [ ] Add validation

- [ ] **Task 2: Add tests**
  - File: tests/auth.test.js
  - [ ] Test valid login
  - [ ] Test invalid login

## Dev Notes

- Use bcrypt for password hashing
- Follow existing error handling patterns in src/utils.js
`;

      const filePath = path.join(tempDir, 'tech-spec-login.md');
      fs.writeFileSync(filePath, techSpecContent);

      const result = await BmadParser.parseBmadFile(filePath);

      assert.strictEqual(result.type, 'tech-spec');
      assert.strictEqual(result.title, 'Add Login Feature');
      assert.strictEqual(result.status, 'ready-for-dev');
      assert.strictEqual(result.acceptanceCriteria.length, 2);
      assert.strictEqual(result.tasks.length, 2);
      assert.ok(result.devNotes.includes('bcrypt'));
      assert.ok(result.fileRefs.includes('src/auth.js'));
    });

    it('should parse story and extract Given/When/Then ACs', async function () {
      const storyContent = `# Story 1.1: User Registration

Status: ready-for-dev

## Story

As a new user, I want to create an account, so that I can access the application.

## Acceptance Criteria

**Given** a visitor on the registration page
**When** they submit valid registration info
**Then** their account is created and they are logged in

**Given** a visitor with an existing email
**When** they try to register
**Then** they see an error message

## Tasks / Subtasks

- [ ] **Task 1: Add registration form**
- [ ] **Task 2: Add email validation**

## Dev Notes

See existing form components in src/components/forms/
`;

      const filePath = path.join(tempDir, 'story-1.1.md');
      fs.writeFileSync(filePath, storyContent);

      const result = await BmadParser.parseBmadFile(filePath);

      assert.strictEqual(result.type, 'story');
      assert.strictEqual(result.status, 'ready-for-dev');
      assert.strictEqual(result.acceptanceCriteria.length, 2);
      assert.strictEqual(result.acceptanceCriteria[0].type, 'gherkin');
      assert.ok(result.acceptanceCriteria[0].given.includes('visitor'));
      assert.ok(result.storyStatement.includes('new user'));
    });
  });

  describe('BMAD Input Detection', function () {
    it('should detect and load BMAD file input', async function () {
      // Create a simple BMAD tech-spec
      const techSpecContent = `---
title: 'Simple Feature'
status: 'ready-for-dev'
---

# Tech-Spec: Simple Feature

## Acceptance Criteria

- [ ] **AC 1**: Feature works

## Implementation Plan

### Tasks

- [ ] **Task 1: Implement feature**
`;

      const filePath = path.join(tempDir, 'tech-spec-simple.md');
      fs.writeFileSync(filePath, techSpecContent);

      // Configure mock runner for BMAD workflow agents
      mockRunner.when('worker').returns(
        JSON.stringify({
          summary: 'Feature implemented',
          files: ['src/feature.js'],
        })
      );

      mockRunner.when('validator').returns(
        JSON.stringify({
          approved: true,
          summary: 'All ACs verified',
          ac_results: [{ id: 1, passed: true, notes: 'Works correctly' }],
          errors: [],
        })
      );

      // Use conductor-bootstrap config which is the default
      const conductorConfig = JSON.parse(
        fs.readFileSync(
          path.join(__dirname, '../../cluster-templates/conductor-bootstrap.json'),
          'utf8'
        )
      );

      orchestrator = new Orchestrator({
        quiet: true,
        storageDir: tempDir,
        taskRunner: mockRunner,
      });

      // Start with BMAD input
      const result = await orchestrator.start(conductorConfig, { bmad: filePath });
      const clusterId = result.id;

      // Wait briefly for the CLUSTER_OPERATIONS message to be published
      // This test validates the BMAD bypass flow, not cluster completion
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Verify CLUSTER_OPERATIONS was published (conductor bypass)
      const cluster = orchestrator.getCluster(clusterId);
      assert.ok(cluster, 'Cluster should exist after start');

      const ledger = cluster.messageBus.ledger;
      const ops = ledger.query({ cluster_id: clusterId, topic: 'CLUSTER_OPERATIONS' });
      assert.ok(ops.length > 0, 'Should publish CLUSTER_OPERATIONS to bypass conductor');

      // Verify it's loading bmad-workflow
      const loadConfig = ops.find((m) => m.content?.data?.operations?.some((op) => op.action === 'load_config'));
      assert.ok(loadConfig, 'Should have load_config operation');

      // Verify the load_config specifies bmad-workflow base template
      const loadConfigOp = loadConfig.content.data.operations.find((op) => op.action === 'load_config');
      assert.strictEqual(loadConfigOp.config.base, 'bmad-workflow', 'Should load bmad-workflow template');
    });
  });

  describe('Directory Scan', function () {
    it('should find ready-for-dev stories in directory', async function () {
      // Create multiple stories with different statuses
      const stories = [
        { name: 'story-1.md', status: 'ready-for-dev' },
        { name: 'story-2.md', status: 'in-progress' },
        { name: 'story-3.md', status: 'ready-for-dev' },
        { name: 'story-4.md', status: 'draft' },
      ];

      for (const story of stories) {
        fs.writeFileSync(
          path.join(tempDir, story.name),
          `# ${story.name}\n\nStatus: ${story.status}\n`
        );
      }

      const result = await BmadParser.findReadyStories(tempDir);

      assert.strictEqual(result.length, 2);
      assert.ok(result.some((f) => f.includes('story-1.md')));
      assert.ok(result.some((f) => f.includes('story-3.md')));
    });

    it('should handle nested directories', async function () {
      // Create nested structure
      const subDir = path.join(tempDir, 'epic-1');
      fs.mkdirSync(subDir);

      fs.writeFileSync(
        path.join(subDir, 'story-1.1.md'),
        '# Story 1.1\n\nStatus: ready-for-dev\n'
      );
      fs.writeFileSync(path.join(subDir, 'story-1.2.md'), '# Story 1.2\n\nStatus: draft\n');

      const result = await BmadParser.findReadyStories(tempDir);

      assert.strictEqual(result.length, 1);
      assert.ok(result[0].includes('story-1.1.md'));
    });
  });

  describe('BMAD File Update on Completion', function () {
    it('should update checkboxes and status after successful completion', async function () {
      const storyContent = `# Story: Test Feature

Status: ready-for-dev

## Tasks

- [ ] Task 1
- [ ] Task 2
`;

      const filePath = path.join(tempDir, 'story-test.md');
      fs.writeFileSync(filePath, storyContent);

      // Import the output writer
      const BmadOutputWriter = require('../../src/bmad-output-writer');

      // Simulate successful completion
      const results = {
        success: true,
        model: 'sonnet',
        completionNotes: ['All tasks completed'],
        filesModified: ['src/test.js'],
      };

      await BmadOutputWriter.updateBmadFile(filePath, results);

      const updated = fs.readFileSync(filePath, 'utf8');

      // Status updated
      assert.ok(updated.includes('Status: review'), 'Status should be updated to review');

      // Tasks marked complete
      assert.ok(updated.includes('- [x] Task 1'), 'Task 1 should be checked');
      assert.ok(updated.includes('- [x] Task 2'), 'Task 2 should be checked');

      // Dev record added
      assert.ok(updated.includes('## Dev Agent Record'), 'Should have Dev Agent Record');
      assert.ok(updated.includes('sonnet'), 'Should include model');
    });

    it('should preserve content on failure', async function () {
      const storyContent = `# Story: Test Feature

Status: ready-for-dev

## Tasks

- [ ] Task 1
`;

      const filePath = path.join(tempDir, 'story-fail.md');
      fs.writeFileSync(filePath, storyContent);

      const BmadOutputWriter = require('../../src/bmad-output-writer');

      const results = { success: false };

      await BmadOutputWriter.updateBmadFile(filePath, results);

      const updated = fs.readFileSync(filePath, 'utf8');

      // Status NOT updated on failure
      assert.ok(updated.includes('Status: ready-for-dev'), 'Status should remain unchanged');
    });
  });

  describe('Sprint Status Update', function () {
    it('should update sprint-status.yaml on completion', async function () {
      // Create sprint status file
      const sprintStatusContent = `epic-1:
  story-1.1: ready-for-dev
  story-1.2: in-progress
  story-1.3: draft
`;

      const sprintPath = path.join(tempDir, 'sprint-status.yaml');
      fs.writeFileSync(sprintPath, sprintStatusContent);

      const BmadOutputWriter = require('../../src/bmad-output-writer');

      await BmadOutputWriter.updateSprintStatus(sprintPath, 'story-1.1', 'review');

      const updated = fs.readFileSync(sprintPath, 'utf8');

      assert.ok(updated.includes('story-1.1: review'), 'Story status should be updated');
      assert.ok(updated.includes('story-1.2: in-progress'), 'Other stories unchanged');
    });
  });

  describe('toInputData Conversion', function () {
    it('should convert BMAD data to inputData format', function () {
      const bmadData = {
        type: 'tech-spec',
        title: 'Test Feature',
        filePath: '/path/to/tech-spec.md',
        status: 'ready-for-dev',
        storyStatement: null,
        acceptanceCriteria: [
          {
            id: 1,
            type: 'gherkin',
            given: 'a user is logged in',
            when: 'they click logout',
            then: 'they are logged out',
          },
          { id: 2, type: 'checkbox', description: 'Feature works correctly' },
        ],
        tasks: [
          {
            id: 1,
            title: 'Implement logout',
            checked: false,
            subtasks: [{ title: 'Add button', checked: false }],
            details: [{ key: 'File', value: 'src/auth.js' }],
          },
        ],
        devNotes: 'Use existing auth patterns',
        fileRefs: ['src/auth.js', 'src/session.js'],
      };

      const inputData = BmadParser.toInputData(bmadData);

      assert.strictEqual(inputData.number, null);
      assert.strictEqual(inputData.title, 'Test Feature');
      assert.ok(inputData.context.includes('Acceptance Criteria'));
      assert.ok(inputData.context.includes('Given'));
      assert.ok(inputData.context.includes('Tasks'));
      assert.ok(inputData.context.includes('Implement logout'));
      assert.ok(inputData.context.includes('Dev Notes'));
      assert.ok(inputData.context.includes('src/auth.js'));
    });
  });
});
