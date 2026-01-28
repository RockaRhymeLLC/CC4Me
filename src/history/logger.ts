/**
 * History Logger
 *
 * Simple append-only logger for tracking command-based changes.
 * Maintains an audit trail of all workflow commands executed.
 */

import * as fs from 'fs';
import * as path from 'path';

export class HistoryLogger {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  /**
   * Log a command change
   * @param command - The command executed (e.g., '/spec', '/plan')
   * @param file - The file that was modified
   * @param description - Description of what changed
   */
  log(command: string, file: string, description: string): void {
    try {
      // Ensure directory exists
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Format log entry
      const timestamp = new Date().toISOString();
      const entry = `[${timestamp}] ${command}: ${description} to ${file}\n`;

      // Append to log file
      fs.appendFileSync(this.filePath, entry, 'utf-8');
    } catch (error) {
      console.error('Failed to write to history log:', error);
      // Don't throw - logging failure shouldn't break the workflow
    }
  }
}
