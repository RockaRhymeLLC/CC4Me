/**
 * Context Tracker
 *
 * Simple persistence layer for tracking active spec/plan files across conversation turns.
 * Stores context in a JSON file to maintain state even after context clearing.
 */

import * as fs from 'fs';
import * as path from 'path';

interface ContextData {
  activeSpec: string | null;
  activePlan: string | null;
  lastCommand: string | null;
  timestamp: string;
}

export class ContextTracker {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  /**
   * Get the currently active spec file path
   */
  getActiveSpec(): string | null {
    const context = this.readContext();
    return context.activeSpec;
  }

  /**
   * Set the active spec file path
   */
  setActiveSpec(specPath: string): void {
    const context = this.readContext();
    context.activeSpec = specPath;
    context.timestamp = new Date().toISOString();
    this.writeContext(context);
  }

  /**
   * Get the currently active plan file path
   */
  getActivePlan(): string | null {
    const context = this.readContext();
    return context.activePlan;
  }

  /**
   * Set the active plan file path
   */
  setActivePlan(planPath: string): void {
    const context = this.readContext();
    context.activePlan = planPath;
    context.timestamp = new Date().toISOString();
    this.writeContext(context);
  }

  /**
   * Clear all context
   */
  clear(): void {
    const emptyContext: ContextData = {
      activeSpec: null,
      activePlan: null,
      lastCommand: null,
      timestamp: new Date().toISOString()
    };
    this.writeContext(emptyContext);
  }

  /**
   * Read context from JSON file
   */
  private readContext(): ContextData {
    try {
      if (!fs.existsSync(this.filePath)) {
        return this.getEmptyContext();
      }

      const content = fs.readFileSync(this.filePath, 'utf-8');
      const data = JSON.parse(content);

      // Validate structure
      return {
        activeSpec: data.activeSpec ?? null,
        activePlan: data.activePlan ?? null,
        lastCommand: data.lastCommand ?? null,
        timestamp: data.timestamp ?? new Date().toISOString()
      };
    } catch (error) {
      // Handle invalid JSON or read errors - reset to empty context
      console.warn('Failed to read context file, resetting:', error);
      return this.getEmptyContext();
    }
  }

  /**
   * Write context to JSON file
   */
  private writeContext(context: ContextData): void {
    try {
      // Ensure directory exists
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Write JSON
      fs.writeFileSync(this.filePath, JSON.stringify(context, null, 2), 'utf-8');
    } catch (error) {
      console.error('Failed to write context file:', error);
      throw error;
    }
  }

  /**
   * Get empty context structure
   */
  private getEmptyContext(): ContextData {
    return {
      activeSpec: null,
      activePlan: null,
      lastCommand: null,
      timestamp: new Date().toISOString()
    };
  }
}
