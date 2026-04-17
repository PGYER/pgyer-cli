import ora, { type Ora } from 'ora';
import { isHuman } from './logger';

/**
 * Spinner wrapper that only shows animation in human mode
 */
export class Spinner {
  private ora: Ora | null = null;
  private lastText: string = '';

  constructor(text: string = '') {
    this.lastText = text;
    if (isHuman()) {
      this.ora = ora(text);
    }
  }

  /**
   * Start the spinner
   */
  start(text?: string): this {
    if (text) {
      this.lastText = text;
    }
    if (this.ora) {
      this.ora.start(text);
    }
    return this;
  }

  /**
   * Stop the spinner and mark as success
   */
  succeed(text?: string): this {
    if (this.ora) {
      this.ora.succeed(text ?? this.lastText);
    }
    return this;
  }

  /**
   * Stop the spinner and mark as failed
   */
  fail(text?: string): this {
    if (this.ora) {
      this.ora.fail(text ?? this.lastText);
    }
    return this;
  }

  /**
   * Stop the spinner
   */
  stop(): this {
    if (this.ora) {
      this.ora.stop();
    }
    return this;
  }

  /**
   * Update spinner text
   */
  text = (text: string): this => {
    this.lastText = text;
    if (this.ora) {
      this.ora.text = text;
    }
    return this;
  };

  /**
   * Clear the spinner
   */
  clear(): this {
    if (this.ora) {
      this.ora.clear();
    }
    return this;
  }
}

/**
 * Create a new spinner instance
 */
export function createSpinner(text?: string): Spinner {
  return new Spinner(text);
}
