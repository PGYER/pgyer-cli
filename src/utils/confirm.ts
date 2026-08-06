import * as readline from 'readline';
import { isNonInteractive } from './logger';

function prompt(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stderr,
    });
    rl.question(`${message} (y/N): `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

export async function confirmDestructiveAction(
  message: string,
  force: boolean
): Promise<void> {
  if (force) return;
  if (isNonInteractive()) {
    throw new Error('Confirmation requires an interactive terminal; use --force to continue');
  }
  if (!(await prompt(message))) {
    throw new Error('Cancelled');
  }
}
