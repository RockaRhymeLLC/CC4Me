/**
 * Tests for: Hello World Example
 * Spec: specs/20260127-example-hello-world.spec.md
 * Plan: plans/20260127-example-hello-world.plan.md
 */

import { describe, it, expect } from '@jest/globals';

// Note: This will fail until implementation exists
// import { hello } from '../src/hello';

describe('Hello World Function', () => {
  describe('Basic Functionality', () => {
    it('should return "Hello, World!" when called with "World"', () => {
      // Arrange
      // const name = 'World';

      // Act
      // const result = hello(name);

      // Assert
      // expect(result).toBe('Hello, World!');
      expect(true).toBe(false); // Placeholder - should fail initially
    });

    it('should return "Hello, Alice!" when called with "Alice"', () => {
      // Arrange
      // const name = 'Alice';

      // Act
      // const result = hello(name);

      // Assert
      // expect(result).toBe('Hello, Alice!');
      expect(true).toBe(false); // Placeholder - should fail initially
    });
  });

  describe('Edge Cases', () => {
    it('should return "Hello, Guest!" when called with empty string', () => {
      // Arrange
      // const name = '';

      // Act
      // const result = hello(name);

      // Assert
      // expect(result).toBe('Hello, Guest!');
      expect(true).toBe(false); // Placeholder - should fail initially
    });

    it('should return "Hello, Guest!" when called with whitespace-only', () => {
      // Arrange
      // const name = '   ';

      // Act
      // const result = hello(name.trim());

      // Assert
      // expect(result).toBe('Hello, Guest!');
      expect(true).toBe(false); // Placeholder - should fail initially
    });
  });

  describe('Custom Prefix', () => {
    it('should support custom greeting prefix', () => {
      // Arrange
      // const name = 'World';
      // const prefix = 'Hi';

      // Act
      // const result = hello(name, prefix);

      // Assert
      // expect(result).toBe('Hi, World!');
      expect(true).toBe(false); // Placeholder - should fail initially
    });
  });
});
