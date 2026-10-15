import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Wordmark resmi dari contoh Kanban AISIN milik user. */
export const AISIN_LOGO = readFileSync(join(__dirname, 'assets', 'aisin-logo.jpg'));
