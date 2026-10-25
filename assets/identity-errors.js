// Turns raw Netlify Identity (GoTrue) errors into plain-English messages.
// context: 'login' | 'request' | 'reset' | 'link'
export function friendly(err, context = 'login') {
  const raw = String(err?.message || err?.error_description || err || '').toLowerCase();
  const status = err?.status || err?.statusCode || 0;

  if (/failed to fetch|networkerror|network request failed|load failed/.test(raw))
    return 'We couldn’t reach the sign-in service. Check your connection and try again.';
  if (status === 429 || /rate limit|too many|security purposes/.test(raw))
    return 'Too many attempts in a short time. Please wait a few minutes and try again.';
  if (/missingidentity|identity is not|not enabled|not configured/.test(raw))
    return 'Team sign-in is temporarily unavailable. Please try again later.';

  if (context === 'login') {
    if (/no user found|password invalid|invalid_grant|invalid login|invalid credentials/.test(raw) && !/not confirmed/.test(raw))
      return 'That email and password don’t match an active account. Check both and try again, or reset your password.';
    if (/not confirmed|confirm/.test(raw))
      return 'This account hasn’t been activated yet. Use the link in your invitation email to create your password.';
  }

  if (context === 'link' || context === 'reset') {
    if (/expired|invalid|not found|no user|token|verify|unauthor|401|403/.test(raw) || status === 401 || status === 403 || status === 404)
      return 'This reset link has expired or has already been used.';
  }

  if (context === 'reset') {
    if (/at least|too short|length|weak/.test(raw))
      return 'That password is too short. Use at least 10 characters.';
  }

  if (context === 'request') return 'We couldn’t send the reset email right now. Please try again in a moment.';
  if (context === 'reset') return 'We couldn’t save your new password. Please try again.';
  return 'Sign in didn’t work. Please try again.';
}
