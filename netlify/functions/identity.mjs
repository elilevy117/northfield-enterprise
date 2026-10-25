export default {
  userSignup(event) {
    const existing = event.user.appMetadata?.roles || [];
    if (existing.includes('logo-admin')) return;
    return { user: { ...event.user, appMetadata: { ...event.user.appMetadata, roles: ['logo-user'] } } };
  }
};
