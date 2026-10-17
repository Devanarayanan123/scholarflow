// Teacher authentication is handled by the server (verified Google Sign-In + HTTP-only cookie).
// Nothing about the teacher account is stored in the browser.

declare global {
  interface Window {
    google?: any;
  }
}

const LEGACY_KEYS = [
  'aegis_google_teacher_profile',
  'aegis_master_admin_credential_v1',
  'aegis_single_active_admin_token',
  'aegis_academic_exams_v1',
  'aegis_academic_submissions_v1',
  'scholarflow_teacher_gmail_profile_v2',
  'scholarflow_authorized_teacher_gmail_v2',
  'scholarflow_exams_v2',
  'scholarflow_submissions_v2'
];

/** Removes every account / quiz record that older versions kept in localStorage. */
export function clearLegacyBrowserData(): void {
  if (typeof window === 'undefined') return;
  LEGACY_KEYS.forEach((key) => localStorage.removeItem(key));
  sessionStorage.removeItem('aegis_teacher_explicitly_logged_out');
  sessionStorage.removeItem('scholarflow_teacher_session_active_v2');
}

const GSI_SRC = 'https://accounts.google.com/gsi/client';
let gsiPromise: Promise<void> | null = null;

/** Loads the official Google Identity Services script once. */
export function loadGoogleIdentityScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('No window'));
  if (window.google?.accounts?.id) return Promise.resolve();
  if (gsiPromise) return gsiPromise;

  gsiPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GSI_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      gsiPromise = null;
      reject(new Error('Failed to load Google Sign-In'));
    };
    document.head.appendChild(script);
  });
  return gsiPromise;
}

/** Stops Google from silently re-selecting the same account after sign-out. */
export function disableGoogleAutoSelect(): void {
  try {
    window.google?.accounts?.id?.disableAutoSelect();
  } catch {
    /* ignore */
  }
}
