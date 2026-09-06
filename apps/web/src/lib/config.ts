export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1'
).trim().replace(/\/$/, '');

export const WS_URL = API_BASE_URL.replace(/\/api\/v1$/, '').replace(/\/api$/, '');
