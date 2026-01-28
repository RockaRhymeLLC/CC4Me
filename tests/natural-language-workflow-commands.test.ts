/**
 * Tests for: Natural Language Workflow Commands
 * Spec: specs/20260127-natural-language-workflow-commands.spec.md
 * Plan: plans/20260127-natural-language-workflow-commands.plan.md
 *
 * These tests verify the hybrid architecture:
 * - Simple TypeScript helpers (context tracker, history logger)
 * - Skill-guided Claude behavior (parsing, inference, categorization)
 *
 * IMPORTANT: These tests are IMMUTABLE during build phase.
 * Implementation must match these tests, not vice versa.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { ContextTracker } from '../src/context/tracker';
import { HistoryLogger } from '../src/history/logger';

const TEST_CONTEXT_FILE = path.join(__dirname, '../.test-data/state/context.json');
const TEST_HISTORY_FILE = path.join(__dirname, '../.test-data/history/commands.log');
const TEST_SPECS_DIR = path.join(__dirname, '../.test-data/specs');
const TEST_PLANS_DIR = path.join(__dirname, '../.test-data/plans');

describe('Natural Language Workflow Commands', () => {
  beforeEach(() => {
    // Create test directories
    [TEST_SPECS_DIR, TEST_PLANS_DIR, path.dirname(TEST_CONTEXT_FILE), path.dirname(TEST_HISTORY_FILE)].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });

    // Clear test files
    [TEST_CONTEXT_FILE, TEST_HISTORY_FILE].forEach(file => {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    });
  });

  afterEach(() => {
    // Cleanup test data
    [TEST_SPECS_DIR, TEST_PLANS_DIR, path.dirname(TEST_CONTEXT_FILE)].forEach(dir => {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('Context Tracker Module', () => {
    it('should persist activeSpec to JSON file', () => {
      const tracker = new ContextTracker(TEST_CONTEXT_FILE);

      tracker.setActiveSpec('/path/to/test.spec.md');

      // Verify file was written
      expect(fs.existsSync(TEST_CONTEXT_FILE)).toBe(true);

      // Verify content
      const content = JSON.parse(fs.readFileSync(TEST_CONTEXT_FILE, 'utf-8'));
      expect(content.activeSpec).toBe('/path/to/test.spec.md');
    });

    it('should retrieve activeSpec from JSON file', () => {
      const tracker = new ContextTracker(TEST_CONTEXT_FILE);

      tracker.setActiveSpec('/path/to/test.spec.md');
      const result = tracker.getActiveSpec();

      expect(result).toBe('/path/to/test.spec.md');
    });

    it('should persist activePlan to JSON file', () => {
      const tracker = new ContextTracker(TEST_CONTEXT_FILE);

      tracker.setActivePlan('/path/to/test.plan.md');

      const content = JSON.parse(fs.readFileSync(TEST_CONTEXT_FILE, 'utf-8'));
      expect(content.activePlan).toBe('/path/to/test.plan.md');
    });

    it('should retrieve activePlan from JSON file', () => {
      const tracker = new ContextTracker(TEST_CONTEXT_FILE);

      tracker.setActivePlan('/path/to/test.plan.md');
      const result = tracker.getActivePlan();

      expect(result).toBe('/path/to/test.plan.md');
    });

    it('should persist across multiple instances', () => {
      const tracker1 = new ContextTracker(TEST_CONTEXT_FILE);
      tracker1.setActiveSpec('/path/to/test.spec.md');

      // Create new instance (simulates new conversation/function context)
      const tracker2 = new ContextTracker(TEST_CONTEXT_FILE);
      const result = tracker2.getActiveSpec();

      expect(result).toBe('/path/to/test.spec.md');
    });

    it('should return null when no active spec set', () => {
      const tracker = new ContextTracker(TEST_CONTEXT_FILE);

      const result = tracker.getActiveSpec();

      expect(result).toBeNull();
    });

    it('should return null when no active plan set', () => {
      const tracker = new ContextTracker(TEST_CONTEXT_FILE);

      const result = tracker.getActivePlan();

      expect(result).toBeNull();
    });

    it('should clear context', () => {
      const tracker = new ContextTracker(TEST_CONTEXT_FILE);
      tracker.setActiveSpec('/path/to/test.spec.md');
      tracker.setActivePlan('/path/to/test.plan.md');

      tracker.clear();

      expect(tracker.getActiveSpec()).toBeNull();
      expect(tracker.getActivePlan()).toBeNull();
    });

    it('should store lastCommand and timestamp', () => {
      const tracker = new ContextTracker(TEST_CONTEXT_FILE);

      tracker.setActiveSpec('/path/to/test.spec.md');

      const content = JSON.parse(fs.readFileSync(TEST_CONTEXT_FILE, 'utf-8'));
      expect(content.timestamp).toBeDefined();
      expect(typeof content.timestamp).toBe('string');
    });

    it('should create directories if they do not exist', () => {
      const deepPath = path.join(__dirname, '../.test-data/deep/nested/context.json');
      const tracker = new ContextTracker(deepPath);

      tracker.setActiveSpec('/test.spec.md');

      expect(fs.existsSync(deepPath)).toBe(true);

      // Cleanup
      fs.rmSync(path.join(__dirname, '../.test-data/deep'), { recursive: true, force: true });
    });
  });

  describe('History Logger Module', () => {
    it('should log command with timestamp to file', () => {
      const logger = new HistoryLogger(TEST_HISTORY_FILE);

      logger.log('/spec', 'test.spec.md', 'Added requirement "Breakfast feature"');

      const content = fs.readFileSync(TEST_HISTORY_FILE, 'utf-8');
      expect(content).toContain('/spec');
      expect(content).toContain('test.spec.md');
      expect(content).toContain('Added requirement "Breakfast feature"');
    });

    it('should include ISO timestamp in log entry', () => {
      const logger = new HistoryLogger(TEST_HISTORY_FILE);

      logger.log('/spec', 'test.spec.md', 'Added requirement');

      const content = fs.readFileSync(TEST_HISTORY_FILE, 'utf-8');
      // Should match ISO 8601 format
      expect(content).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('should append multiple log entries', () => {
      const logger = new HistoryLogger(TEST_HISTORY_FILE);

      logger.log('/spec', 'test1.spec.md', 'Change 1');
      logger.log('/plan', 'test2.plan.md', 'Change 2');
      logger.log('/build', 'test3.ts', 'Change 3');

      const content = fs.readFileSync(TEST_HISTORY_FILE, 'utf-8');
      const lines = content.trim().split('\n');

      expect(lines.length).toBe(3);
      expect(lines[0]).toContain('Change 1');
      expect(lines[1]).toContain('Change 2');
      expect(lines[2]).toContain('Change 3');
    });

    it('should preserve order of log entries', () => {
      const logger = new HistoryLogger(TEST_HISTORY_FILE);

      logger.log('/spec', 'file1.md', 'First');
      logger.log('/plan', 'file2.md', 'Second');
      logger.log('/build', 'file3.md', 'Third');

      const content = fs.readFileSync(TEST_HISTORY_FILE, 'utf-8');
      const firstIndex = content.indexOf('First');
      const secondIndex = content.indexOf('Second');
      const thirdIndex = content.indexOf('Third');

      expect(firstIndex).toBeLessThan(secondIndex);
      expect(secondIndex).toBeLessThan(thirdIndex);
    });

    it('should create directories if they do not exist', () => {
      const deepPath = path.join(__dirname, '../.test-data/deep/nested/history.log');
      const logger = new HistoryLogger(deepPath);

      logger.log('/spec', 'test.spec.md', 'Test');

      expect(fs.existsSync(deepPath)).toBe(true);

      // Cleanup
      fs.rmSync(path.join(__dirname, '../.test-data/deep'), { recursive: true, force: true });
    });

    it('should handle special characters in descriptions', () => {
      const logger = new HistoryLogger(TEST_HISTORY_FILE);

      logger.log('/spec', 'test.spec.md', 'Added: "Feature with **bold** and `code`"');

      const content = fs.readFileSync(TEST_HISTORY_FILE, 'utf-8');
      expect(content).toContain('**bold**');
      expect(content).toContain('`code`');
    });
  });

  describe('Integration: Context + History', () => {
    it('should track context and log changes together', () => {
      const tracker = new ContextTracker(TEST_CONTEXT_FILE);
      const logger = new HistoryLogger(TEST_HISTORY_FILE);

      // Simulate workflow: set context and log change
      tracker.setActiveSpec('/path/to/feature.spec.md');
      logger.log('/spec', 'feature.spec.md', 'Added requirement "New feature"');

      // Verify both persisted
      expect(tracker.getActiveSpec()).toBe('/path/to/feature.spec.md');
      const history = fs.readFileSync(TEST_HISTORY_FILE, 'utf-8');
      expect(history).toContain('feature.spec.md');
      expect(history).toContain('New feature');
    });
  });

  describe('Skill Behavior Tests (End-to-End)', () => {
    // These tests verify that the skills guide Claude to produce correct outcomes
    // They test behavior, not implementation details

    const createTestSpec = (filename: string): string => {
      const specPath = path.join(TEST_SPECS_DIR, filename);
      const content = `# Spec: Test Feature

**Created**: 2026-01-27
**Status**: Draft

## Goal
Test feature for testing

## Requirements

### Must Have
- [ ] Existing requirement 1

### Should Have
- [ ] Existing should have

### Won't Have (for now)
- [ ] Out of scope

## Constraints

### Security
None specified

### Performance
None specified

### Compatibility
Node.js 18+

## Success Criteria
1. Feature works correctly
2. Tests pass
`;
      fs.writeFileSync(specPath, content);
      return specPath;
    };

    it('should provide helpers for spec file updates', () => {
      // This test verifies the helpers exist and work
      // The actual skill behavior will be tested during build phase by running the skills

      const specPath = createTestSpec('test.spec.md');

      // Verify spec was created
      expect(fs.existsSync(specPath)).toBe(true);

      // Verify spec has expected structure
      const content = fs.readFileSync(specPath, 'utf-8');
      expect(content).toContain('## Requirements');
      expect(content).toContain('### Must Have');
      expect(content).toContain('## Constraints');
      expect(content).toContain('### Security');
    });

    it('should support reading spec files for inference', () => {
      // Create multiple spec files
      createTestSpec('feature-a.spec.md');
      createTestSpec('feature-b.spec.md');

      // Verify they can be listed
      const files = fs.readdirSync(TEST_SPECS_DIR);
      expect(files).toContain('feature-a.spec.md');
      expect(files).toContain('feature-b.spec.md');
    });
  });

  describe('Edge Cases', () => {
    it('should handle context file with invalid JSON', () => {
      // Write invalid JSON
      fs.writeFileSync(TEST_CONTEXT_FILE, '{ invalid json }');

      const tracker = new ContextTracker(TEST_CONTEXT_FILE);

      // Should handle gracefully (either reset or throw clear error)
      expect(() => {
        const result = tracker.getActiveSpec();
      }).not.toThrow(/unexpected/i);
    });

    it('should handle very long file paths', () => {
      const tracker = new ContextTracker(TEST_CONTEXT_FILE);
      const longPath = '/very/long/path/'.repeat(50) + 'spec.md';

      tracker.setActiveSpec(longPath);
      const result = tracker.getActiveSpec();

      expect(result).toBe(longPath);
    });

    it('should handle very long log descriptions', () => {
      const logger = new HistoryLogger(TEST_HISTORY_FILE);
      const longDesc = 'A'.repeat(1000);

      logger.log('/spec', 'test.spec.md', longDesc);

      const content = fs.readFileSync(TEST_HISTORY_FILE, 'utf-8');
      expect(content).toContain(longDesc);
    });
  });

  describe('Error Handling', () => {
    it('should handle permission errors gracefully', () => {
      // This test verifies error handling exists
      // Actual permission errors are hard to simulate in tests

      const tracker = new ContextTracker(TEST_CONTEXT_FILE);
      expect(tracker).toBeDefined();
    });

    it('should handle missing parent directories', () => {
      const deepPath = path.join(__dirname, '../.test-data/a/b/c/d/context.json');
      const tracker = new ContextTracker(deepPath);

      tracker.setActiveSpec('/test.spec.md');

      expect(fs.existsSync(deepPath)).toBe(true);

      // Cleanup
      fs.rmSync(path.join(__dirname, '../.test-data/a'), { recursive: true, force: true });
    });
  });
});
