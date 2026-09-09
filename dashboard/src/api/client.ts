export const API_BASE_URL = 'http://localhost:8000';
export const DASHBOARD_TOKEN = 'credresolve-secret-2026';

export async function fetchWithAuth<T>(endpoint: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${endpoint}`, {
    headers: {
      'Authorization': `Bearer ${DASHBOARD_TOKEN}`,
    },
  });
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${res.statusText}`);
  }
  return res.json();
}
