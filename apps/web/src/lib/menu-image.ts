import { apiRequest, type ApiEnvelope } from './api-client';

export interface MenuItemImage {
  thumbnailUrl: string;
  standardUrl: string;
  highResolutionUrl: string;
  width: number;
  height: number;
}

export interface MenuImageDraft {
  file: File;
  previewUrl: string;
  crop: { x: number; y: number; width: number; height: number; rotation: number };
}

/** Thrown for direct-to-S3 upload transport failures; callers map it to a localized message. */
export class MenuImageUploadError extends Error {
  constructor() {
    super('Menu image upload to storage failed');
    this.name = 'MenuImageUploadError';
  }
}

export async function uploadMenuImage(params: { itemId: string; version: number; draft: MenuImageDraft; accessToken: string; csrfToken: string | null; tenantId: string }) {
  const bytes = await params.draft.file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const sha256 = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const intent = await apiRequest<ApiEnvelope<{ mediaObjectId: string; uploadUrl: string; fields: Record<string, string> }>>(`/items/${params.itemId}/image/upload-intent`, {
    method: 'POST', accessToken: params.accessToken, csrfToken: params.csrfToken, tenantId: params.tenantId,
    body: { contentType: params.draft.file.type, sizeBytes: params.draft.file.size, sha256, crop: params.draft.crop, expectedVersion: params.version },
  });
  const form = new FormData();
  Object.entries(intent.data.fields).forEach(([key, value]) => form.append(key, value));
  form.append('file', params.draft.file);
  const uploaded = await fetch(intent.data.uploadUrl, { method: 'POST', body: form });
  if (!uploaded.ok) throw new MenuImageUploadError();
  await apiRequest(`/items/${params.itemId}/image/finalize`, { method: 'POST', accessToken: params.accessToken, csrfToken: params.csrfToken, tenantId: params.tenantId, body: { mediaObjectId: intent.data.mediaObjectId, expectedVersion: params.version } });
  return intent.data.mediaObjectId;
}
