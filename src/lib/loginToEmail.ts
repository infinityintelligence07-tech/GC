const LOGIN_EMAIL_OVERRIDES: Record<string, string> = {
  tiagofiel: 'contatotiagofiel@gmail.com',
};

export function loginToEmail(login: string): string {
  const t = (login || '').trim().toLowerCase();
  if (!t) return t;
  if (LOGIN_EMAIL_OVERRIDES[t]) return LOGIN_EMAIL_OVERRIDES[t];
  if (t.includes('@')) return t;
  return `${t.replace(/[^a-z0-9._-]/g, '')}@app.local`;
}
