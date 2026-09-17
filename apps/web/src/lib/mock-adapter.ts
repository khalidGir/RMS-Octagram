import { apiRequest } from './api-client';

const USE_MOCKS = process.env.NEXT_PUBLIC_USE_MOCKS === 'true';

type MockableRequest = {
  <T>(path: string, options?: Parameters<typeof apiRequest>[1]): Promise<T>;
};

async function mockFetch<T>(path: string, _options?: Parameters<typeof apiRequest>[1]): Promise<T> {
  const { getMockData } = await import('./mock-fixtures');
  const mockData = getMockData(path);
  return { data: mockData } as T;
}

export const fetchApi: MockableRequest = USE_MOCKS ? mockFetch : apiRequest;

export function shouldUseMocks(): boolean {
  return USE_MOCKS;
}
