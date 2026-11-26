// ═══════════════════════════════════════════════
//  SETTINGS
// ═══════════════════════════════════════════════
// Google sign-in + Drive sync. Put your OAuth client ID in a `.env` file at the project root:
//   VITE_GOOGLE_CLIENT_ID=1234567890-abc.apps.googleusercontent.com
// (see GOOGLE_SETUP.md). Without it, the sign-in button simply doesn't appear.
export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

// Google Classroom import has its own switch: it needs the Classroom API and Google's longer
// review, so it stays hidden until VITE_CLASSROOM_IMPORT=on is set (as a build variable on Cloudflare).
export const CLASSROOM_IMPORT = GOOGLE_CLIENT_ID && /^(on|true|1|yes)$/i.test(import.meta.env.VITE_CLASSROOM_IMPORT || '');

// The file ClassMap keeps in the teacher's Google Drive
export const DRIVE_FILE_NAME = 'ClassMap data.json';
