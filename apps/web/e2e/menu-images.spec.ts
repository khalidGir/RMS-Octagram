import { test, expect } from './fixtures';
import type { Page, Route } from '@playwright/test';

// First test in the run pays the Next dev cold-compile cost for the
// login/landing/menu routes; give the file budget for that warm-up.
test.describe.configure({ timeout: 120_000 });

// 800 x 600 solid-color PNG (palette-compressed, 581 bytes) — large enough for
// the cropper, small enough to keep in source.
const PHOTO_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAyAAAAJYCAMAAACtqHJCAAAAA1BMVEXSUC3WE92lAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAB6ElEQVR42u3BAQ0AAADCoPdPbQ8HFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPwYVcEAAU0jFZQAAAAASUVORK5CYII=';
const PHOTO_BUFFER = Buffer.from(PHOTO_PNG_BASE64, 'base64');
const S3_UPLOAD_URL = 'https://s3-e2e.invalid/menu-photo.png';

interface PipelineCalls {
  intentBodies: Array<Record<string, unknown>>;
  s3ContentTypes: Array<string | null>;
  finalizeBodies: Array<Record<string, unknown>>;
  statusRequests: number;
}

function corsHeaders(route: Route): Record<string, string> {
  const request = route.request();
  const origin = request.headers()['origin'] ?? '*';
  const requestedHeaders = request.headers()['access-control-request-headers'] ?? 'authorization,content-type';
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
    'access-control-allow-headers': requestedHeaders,
    'access-control-max-age': '600',
  };
}

async function fulfillPreflight(route: Route): Promise<boolean> {
  if (route.request().method() !== 'OPTIONS') return false;
  await route.fulfill({ status: 204, headers: corsHeaders(route) });
  return true;
}

// Browser-level stubs for the whole photo pipeline: intent → S3 POST →
// finalize → status. Nothing here touches the real API or AWS (correction 4),
// and both the success and the failure outcome are covered.
async function stubPhotoPipeline(page: Page, outcome: 'READY' | 'REJECTED' | 'S3_FAIL'): Promise<PipelineCalls> {
  const calls: PipelineCalls = { intentBodies: [], s3ContentTypes: [], finalizeBodies: [], statusRequests: 0 };

  await page.route('**/api/v1/items/*/image/upload-intent', async (route) => {
    if (await fulfillPreflight(route)) return;
    calls.intentBodies.push(route.request().postDataJSON());
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      headers: corsHeaders(route),
      body: JSON.stringify({
        data: { mediaObjectId: 'e2e-media-001', uploadUrl: S3_UPLOAD_URL, fields: { key: 'menu/e2e-photo.png' } },
      }),
    });
  });

  await page.route(S3_UPLOAD_URL, async (route) => {
    if (await fulfillPreflight(route)) return;
    calls.s3ContentTypes.push(route.request().headers()['content-type'] ?? null);
    // A transport failure must stay a CORS-valid 403 so the client observes
    // `!ok` (MenuImageUploadError) instead of a network error.
    const failed = outcome === 'S3_FAIL';
    await route.fulfill({
      status: failed ? 403 : 204,
      headers: corsHeaders(route),
      body: failed ? 'forbidden' : '',
    });
  });

  await page.route('**/api/v1/items/*/image/finalize', async (route) => {
    if (await fulfillPreflight(route)) return;
    calls.finalizeBodies.push(route.request().postDataJSON());
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      headers: corsHeaders(route),
      body: JSON.stringify({ data: { mediaObjectId: 'e2e-media-001', processingStatus: 'PENDING_PROCESSING' } }),
    });
  });

  await page.route('**/api/v1/items/*/image/status*', async (route) => {
    if (await fulfillPreflight(route)) return;
    calls.statusRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: corsHeaders(route),
      body: JSON.stringify({
        data:
          outcome === 'REJECTED'
            ? { processingStatus: 'REJECTED', rejectionReason: 'unsupported-image' }
            : { processingStatus: 'READY', rejectionReason: null },
      }),
    });
  });

  return calls;
}

async function attachPhoto(page: Page) {
  await page.goto('/menu');
  const editCard = page.getByRole('button', { name: 'Edit Test Burger' });
  await expect(editCard).toBeVisible({ timeout: 20_000 });
  await page.waitForLoadState('networkidle');
  await editCard.click();
  const dialog = page.getByRole('dialog', { name: 'Edit Test Burger' });
  await expect(dialog).toBeVisible();
  await dialog.locator('input[type="file"]').setInputFiles({
    name: 'menu-photo.png',
    mimeType: 'image/png',
    buffer: PHOTO_BUFFER,
  });
  await page.getByRole('button', { name: 'Use this crop' }).click();
  await dialog.getByRole('button', { name: 'Upload photo' }).click();
}

test.describe('menu item photo upload', () => {
  test('uploads a photo and reports it ready after processing', async ({ managerPage }) => {
    const calls = await stubPhotoPipeline(managerPage, 'READY');

    await attachPhoto(managerPage);

    await expect(managerPage.getByText('Photo is ready.')).toBeVisible({ timeout: 15_000 });

    expect(calls.intentBodies).toHaveLength(1);
    expect(calls.s3ContentTypes).toHaveLength(1);
    expect(calls.s3ContentTypes[0]).toContain('multipart/form-data');
    expect(calls.finalizeBodies).toHaveLength(1);
    expect(calls.statusRequests).toBeGreaterThanOrEqual(1);

    const intent = calls.intentBodies[0];
    expect(intent.contentType).toBe('image/png');
    expect(intent.sizeBytes).toBe(PHOTO_BUFFER.length);
    expect(String(intent.sha256)).toMatch(/^[0-9a-f]{64}$/);
    const crop = intent.crop as { x: number; y: number; width: number; height: number; rotation: number };
    expect(crop.x).toBeGreaterThanOrEqual(0);
    expect(crop.y).toBeGreaterThanOrEqual(0);
    expect(crop.width).toBeGreaterThan(0);
    expect(crop.width).toBeLessThanOrEqual(1);
    expect(crop.height).toBeGreaterThan(0);
    expect(crop.height).toBeLessThanOrEqual(1);
    expect([0, 90, 180, 270]).toContain(crop.rotation);
    expect(typeof intent.expectedVersion).toBe('number');

    const finalize = calls.finalizeBodies[0];
    expect(finalize.mediaObjectId).toBe('e2e-media-001');
    expect(typeof finalize.expectedVersion).toBe('number');
  });

  test('surfaces a localized rejection when processing reports REJECTED', async ({ managerPage }) => {
    const calls = await stubPhotoPipeline(managerPage, 'REJECTED');

    await attachPhoto(managerPage);

    await expect(
      managerPage.getByRole('alert').filter({ hasText: 'The photo could not be processed.' }),
    ).toBeVisible({ timeout: 15_000 });
    expect(managerPage.getByText('Photo is ready.')).toHaveCount(0);

    expect(calls.intentBodies).toHaveLength(1);
    expect(calls.s3ContentTypes).toHaveLength(1);
    expect(calls.finalizeBodies).toHaveLength(1);
    expect(calls.statusRequests).toBeGreaterThanOrEqual(1);
  });

  test('reports a transport failure without calling finalize', async ({ managerPage }) => {
    const calls = await stubPhotoPipeline(managerPage, 'S3_FAIL');

    await attachPhoto(managerPage);

    await expect(
      managerPage.getByRole('alert').filter({ hasText: 'Photo upload failed. Try again safely.' }),
    ).toBeVisible({ timeout: 15_000 });

    expect(calls.intentBodies).toHaveLength(1);
    expect(calls.s3ContentTypes).toHaveLength(1);
    expect(calls.finalizeBodies).toHaveLength(0);
    expect(calls.statusRequests).toBe(0);
  });
});
