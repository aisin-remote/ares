import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Logo PT Aisin Indonesia Automotive (wordmark + nama perusahaan), PNG latar transparan dari user. */
export const AISIN_LOGO = readFileSync(join(__dirname, 'assets', 'aisin-logo.png'));
