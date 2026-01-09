/**
 * Tests for BMAD Parser
 * Validates parsing of story and tech-spec files
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const BmadParser = require('../src/bmad-parser');

describe('BmadParser', function () {
  let tempDir;

  beforeEach(async function () {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bmad-parser-test-'));
  });

  afterEach(async function () {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  describe('extractFrontmatter', function () {
    it('should parse simple YAML frontmatter', function () {
      const content = `---
title: 'Test Feature'
slug: 'test-feature'
status: 'ready-for-dev'
---

# Content here`;

      const result = BmadParser.extractFrontmatter(content);
      assert.strictEqual(result.title, 'Test Feature');
      assert.strictEqual(result.slug, 'test-feature');
      assert.strictEqual(result.status, 'ready-for-dev');
    });

    it('should parse inline arrays', function () {
      const content = `---
stepsCompleted: [1, 2, 3]
tech_stack: ['JavaScript', 'Node.js']
---`;

      const result = BmadParser.extractFrontmatter(content);
      assert.deepStrictEqual(result.stepsCompleted, ['1', '2', '3']);
      assert.deepStrictEqual(result.tech_stack, ['JavaScript', 'Node.js']);
    });

    it('should parse multiline arrays', function () {
      const content = `---
files_to_modify:
  - src/foo.js
  - src/bar.js
---`;

      const result = BmadParser.extractFrontmatter(content);
      assert.deepStrictEqual(result.files_to_modify, ['src/foo.js', 'src/bar.js']);
    });

    it('should return empty object for no frontmatter', function () {
      const content = '# Just a heading\n\nSome content';
      const result = BmadParser.extractFrontmatter(content);
      assert.deepStrictEqual(result, {});
    });

    it('should handle quoted values containing colons', function () {
      const content = `---
title: 'Feature: User Login'
description: "Step 1: Open app"
simple: plain value
---`;

      const result = BmadParser.extractFrontmatter(content);
      assert.strictEqual(result.title, 'Feature: User Login');
      assert.strictEqual(result.description, 'Step 1: Open app');
      assert.strictEqual(result.simple, 'plain value');
    });

    it('should handle inline arrays with quoted items containing commas', function () {
      const content = `---
items: ['one, two', "three, four", five]
---`;

      const result = BmadParser.extractFrontmatter(content);
      assert.deepStrictEqual(result.items, ['one, two', 'three, four', 'five']);
    });
  });

  describe('extractAcceptanceCriteria', function () {
    it('should parse Given/When/Then format', function () {
      const content = `## Acceptance Criteria

**Given** a user is logged in
**When** they click the logout button
**Then** they are redirected to the login page

**Given** an admin user
**When** they access the dashboard
**Then** they see admin controls`;

      const result = BmadParser.extractAcceptanceCriteria(content);
      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].type, 'gherkin');
      assert.strictEqual(result[0].given, 'a user is logged in');
      assert.strictEqual(result[0].when, 'they click the logout button');
      assert.strictEqual(result[0].then, 'they are redirected to the login page');
    });

    it('should parse checkbox AC format', function () {
      const content = `## Acceptance Criteria

- [ ] **AC 1**: User can log in with email
- [x] **AC 2**: User can reset password`;

      const result = BmadParser.extractAcceptanceCriteria(content);
      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].type, 'checkbox');
      assert.strictEqual(result[0].id, 1);
      assert.strictEqual(result[0].description, 'User can log in with email');
    });

    it('should parse bullet point format', function () {
      const content = `## Acceptance Criteria

- User can create an account
- User can verify email`;

      const result = BmadParser.extractAcceptanceCriteria(content);
      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].type, 'bullet');
      assert.strictEqual(result[0].description, 'User can create an account');
    });
  });

  describe('extractTasks', function () {
    it('should parse numbered tasks with subtasks', function () {
      const content = `## Tasks

- [ ] **Task 1: Create parser module**
  - File: src/parser.js
  - Action: Create new file
  - [ ] Parse YAML frontmatter
  - [ ] Parse markdown sections

- [ ] **Task 2: Add tests**
  - File: tests/parser.test.js`;

      const result = BmadParser.extractTasks(content);
      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].id, 1);
      assert.strictEqual(result[0].title, 'Create parser module');
      assert.strictEqual(result[0].checked, false);
      assert.strictEqual(result[0].subtasks.length, 2);
      assert.strictEqual(result[0].details.length, 2);
    });

    it('should handle checked tasks', function () {
      const content = `## Tasks

- [x] **Task 1: Completed task**`;

      const result = BmadParser.extractTasks(content);
      assert.strictEqual(result[0].checked, true);
    });

    it('should find tasks under Implementation Plan', function () {
      const content = `## Implementation Plan

### Tasks

- [ ] **Task 1: First task**
- [ ] **Task 2: Second task**`;

      const result = BmadParser.extractTasks(content);
      assert.strictEqual(result.length, 2);
    });
  });

  describe('extractDevNotes', function () {
    it('should extract Dev Notes section', function () {
      const content = `## Tasks
- [ ] Task 1

## Dev Notes
- Use the existing pattern from src/utils.js
- Follow ESLint config

## Next Section`;

      const result = BmadParser.extractDevNotes(content);
      assert.ok(result.includes('Use the existing pattern'));
      assert.ok(result.includes('Follow ESLint config'));
    });

    it('should extract Additional Context section', function () {
      const content = `## Additional Context

Important implementation notes here.`;

      const result = BmadParser.extractDevNotes(content);
      assert.ok(result.includes('Important implementation notes'));
    });

    it('should return null when no dev notes', function () {
      const content = `## Just Tasks

- [ ] A task`;

      const result = BmadParser.extractDevNotes(content);
      assert.strictEqual(result, null);
    });
  });

  describe('extractFileRefs', function () {
    it('should extract backtick file paths', function () {
      const content = 'Look at `src/utils.js` and `lib/helpers.ts`';
      const result = BmadParser.extractFileRefs(content);
      assert.ok(result.includes('src/utils.js'));
      assert.ok(result.includes('lib/helpers.ts'));
    });

    it('should extract File: prefixed paths', function () {
      const content = `File: src/main.js
File: \`tests/main.test.js\``;

      const result = BmadParser.extractFileRefs(content);
      assert.ok(result.includes('src/main.js'));
      assert.ok(result.includes('tests/main.test.js'));
    });

    it('should remove line numbers from paths', function () {
      const content = 'See `src/foo.js:123` for reference';
      const result = BmadParser.extractFileRefs(content);
      assert.ok(result.includes('src/foo.js'));
      assert.ok(!result.includes('src/foo.js:123'));
    });

    it('should deduplicate file refs', function () {
      const content = 'Use `src/foo.js` and also see `src/foo.js`';
      const result = BmadParser.extractFileRefs(content);
      assert.strictEqual(result.filter((f) => f === 'src/foo.js').length, 1);
    });
  });

  describe('parseBmadFile', function () {
    it('should parse tech-spec with frontmatter', async function () {
      const techSpecContent = `---
title: 'Test Feature'
slug: 'test-feature'
status: 'ready-for-dev'
stepsCompleted: [1, 2]
tech_stack:
  - JavaScript
files_to_modify:
  - src/index.js
---

# Tech-Spec: Test Feature

## Overview

This is a test feature.

## Acceptance Criteria

- [ ] **AC 1**: Feature works correctly

## Implementation Plan

### Tasks

- [ ] **Task 1: Implement feature**
  - File: src/index.js
  - [ ] Add the code
`;

      const filePath = path.join(tempDir, 'tech-spec-test.md');
      await fs.writeFile(filePath, techSpecContent);

      const result = await BmadParser.parseBmadFile(filePath);

      assert.strictEqual(result.type, 'tech-spec');
      assert.strictEqual(result.title, 'Test Feature');
      assert.strictEqual(result.status, 'ready-for-dev');
      assert.deepStrictEqual(result.stepsCompleted, ['1', '2']);
      assert.ok(result.acceptanceCriteria.length >= 1);
      assert.ok(result.tasks.length >= 1);
    });

    it('should parse story without frontmatter', async function () {
      const storyContent = `# Story 1.1: User Login

Status: ready-for-dev

## Story

As a user, I want to log in with my email, so that I can access my account.

## Acceptance Criteria

**Given** a registered user
**When** they enter valid credentials
**Then** they are logged in

## Tasks / Subtasks

- [ ] **Task 1: Add login form**
- [ ] **Task 2: Add validation**

## Dev Notes

- Use existing auth patterns
`;

      const filePath = path.join(tempDir, 'story-1.1.md');
      await fs.writeFile(filePath, storyContent);

      const result = await BmadParser.parseBmadFile(filePath);

      assert.strictEqual(result.type, 'story');
      assert.strictEqual(result.title, 'User Login');
      assert.strictEqual(result.status, 'ready-for-dev');
      assert.ok(result.storyStatement);
      assert.ok(result.acceptanceCriteria.length >= 1);
      assert.ok(result.tasks.length >= 1);
    });
  });

  describe('toInputData', function () {
    it('should convert BMAD data to inputData format', function () {
      const bmadData = {
        type: 'tech-spec',
        title: 'Test Feature',
        storyStatement: null,
        acceptanceCriteria: [
          { id: 1, type: 'gherkin', given: 'condition', when: 'action', then: 'result' },
        ],
        tasks: [{ id: 1, title: 'First task', details: [], subtasks: [] }],
        devNotes: 'Some dev notes',
        fileRefs: ['src/foo.js'],
      };

      const result = BmadParser.toInputData(bmadData);

      assert.strictEqual(result.number, null);
      assert.strictEqual(result.title, 'Test Feature');
      assert.ok(result.body.includes('Tech-Spec: Test Feature'));
      assert.ok(result.context.includes('Acceptance Criteria'));
      assert.ok(result.context.includes('Tasks'));
      assert.ok(result.context.includes('Dev Notes'));
      assert.ok(result.context.includes('src/foo.js'));
    });
  });

  describe('findReadyStories', function () {
    it('should find ready-for-dev stories in directory', async function () {
      // Create test files
      await fs.writeFile(
        path.join(tempDir, 'story-1.md'),
        '# Story 1\n\nStatus: ready-for-dev\n'
      );
      await fs.writeFile(path.join(tempDir, 'story-2.md'), '# Story 2\n\nStatus: in-progress\n');
      await fs.writeFile(
        path.join(tempDir, 'story-3.md'),
        '# Story 3\n\nStatus: ready-for-dev\n'
      );

      const result = await BmadParser.findReadyStories(tempDir);

      assert.strictEqual(result.length, 2);
      assert.ok(result.some((f) => f.includes('story-1.md')));
      assert.ok(result.some((f) => f.includes('story-3.md')));
    });

    it('should find ready-for-dev tech-specs with frontmatter', async function () {
      await fs.writeFile(
        path.join(tempDir, 'tech-spec.md'),
        "---\nstatus: 'ready-for-dev'\n---\n# Tech-Spec\n"
      );

      const result = await BmadParser.findReadyStories(tempDir);

      assert.strictEqual(result.length, 1);
    });

    it('should return empty array when no ready stories', async function () {
      await fs.writeFile(path.join(tempDir, 'story.md'), '# Story\n\nStatus: draft\n');

      const result = await BmadParser.findReadyStories(tempDir);

      assert.strictEqual(result.length, 0);
    });

    it('should scan subdirectories', async function () {
      const subDir = path.join(tempDir, 'stories');
      await fs.mkdir(subDir);
      await fs.writeFile(
        path.join(subDir, 'story-1.md'),
        '# Story 1\n\nStatus: ready-for-dev\n'
      );

      const result = await BmadParser.findReadyStories(tempDir);

      assert.strictEqual(result.length, 1);
    });
  });

  describe('isBmadFile', function () {
    it('should recognize story files', function () {
      assert.strictEqual(BmadParser.isBmadFile('story-1.1.md'), true);
      assert.strictEqual(BmadParser.isBmadFile('Story-Feature.md'), true);
    });

    it('should recognize tech-spec files', function () {
      assert.strictEqual(BmadParser.isBmadFile('tech-spec-auth.md'), true);
      assert.strictEqual(BmadParser.isBmadFile('techspec-api.md'), true);
    });

    it('should reject non-BMAD markdown files', function () {
      assert.strictEqual(BmadParser.isBmadFile('README.md'), false);
      assert.strictEqual(BmadParser.isBmadFile('CHANGELOG.md'), false);
    });

    it('should reject non-markdown files', function () {
      assert.strictEqual(BmadParser.isBmadFile('story.txt'), false);
      assert.strictEqual(BmadParser.isBmadFile('tech-spec.json'), false);
    });
  });

  describe('validateBmadFile', function () {
    it('should pass valid story file', async function () {
      const filePath = path.join(tempDir, 'story.md');
      await fs.writeFile(filePath, '# Story Title\n\nStatus: ready-for-dev\n');

      const result = await BmadParser.validateBmadFile(filePath);

      assert.strictEqual(result.valid, true);
    });

    it('should pass valid tech-spec file', async function () {
      const filePath = path.join(tempDir, 'tech-spec.md');
      await fs.writeFile(filePath, "---\nstatus: 'ready-for-dev'\n---\n\n# Tech-Spec Title\n");

      const result = await BmadParser.validateBmadFile(filePath);

      assert.strictEqual(result.valid, true);
    });

    it('should fail empty file', async function () {
      const filePath = path.join(tempDir, 'empty.md');
      await fs.writeFile(filePath, '');

      const result = await BmadParser.validateBmadFile(filePath);

      assert.strictEqual(result.valid, false);
      assert.ok(result.error.includes('empty'));
    });

    it('should fail file without title', async function () {
      const filePath = path.join(tempDir, 'notitle.md');
      await fs.writeFile(filePath, 'Just some text without heading');

      const result = await BmadParser.validateBmadFile(filePath);

      assert.strictEqual(result.valid, false);
      assert.ok(result.error.includes('title'));
    });

    it('should fail story without Status line', async function () {
      const filePath = path.join(tempDir, 'nostatus.md');
      await fs.writeFile(filePath, '# Story Title\n\nNo status here');

      const result = await BmadParser.validateBmadFile(filePath);

      assert.strictEqual(result.valid, false);
      assert.ok(result.error.includes('Status'));
    });

    it('should fail tech-spec with malformed frontmatter', async function () {
      const filePath = path.join(tempDir, 'badfront.md');
      // Missing closing --- - note we add a title to pass that check first
      await fs.writeFile(filePath, '---\nstatus: ready\nno closing\n\n# Title Here');

      const result = await BmadParser.validateBmadFile(filePath);

      assert.strictEqual(result.valid, false);
      assert.ok(result.error.includes('frontmatter') || result.error.includes('closing'),
        `Expected error about frontmatter but got: ${result.error}`);
    });
  });
});
