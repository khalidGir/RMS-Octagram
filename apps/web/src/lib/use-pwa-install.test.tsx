import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePwaInstall, type InstallOutcome } from './use-pwa-install';

interface InstallPromptStub extends Event {
  prompt: ReturnType<typeof vi.fn>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

function dispatchInstallPrompt(outcome: 'accepted' | 'dismissed'): InstallPromptStub {
  const event = new Event('beforeinstallprompt') as InstallPromptStub;
  event.prompt = vi.fn().mockResolvedValue(undefined);
  event.userChoice = Promise.resolve({ outcome, platform: 'chromium' });
  window.dispatchEvent(event);
  return event;
}

const originalMatchMedia = window.matchMedia;
const originalUserAgent = window.navigator.userAgent;

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  Object.defineProperty(window.navigator, 'userAgent', {
    value: originalUserAgent,
    configurable: true,
  });
});

describe('usePwaInstall', () => {
  it('reports nothing installable before the browser offers a prompt', () => {
    const { result } = renderHook(() => usePwaInstall());
    expect(result.current.canInstall).toBe(false);
    expect(result.current.installed).toBe(false);
    expect(result.current.iosInstallable).toBe(false);
  });

  it('exposes the prompt once beforeinstallprompt fires and consumes it when accepted', async () => {
    const { result } = renderHook(() => usePwaInstall());
    act(() => {
      dispatchInstallPrompt('accepted');
    });
    await waitFor(() => expect(result.current.canInstall).toBe(true));

    let outcome: InstallOutcome = 'unavailable';
    await act(async () => {
      outcome = await result.current.promptInstall();
    });
    expect(outcome).toBe('accepted');
    await waitFor(() => expect(result.current.canInstall).toBe(false));
  });

  it('keeps the prompt available when the user dismisses it', async () => {
    const { result } = renderHook(() => usePwaInstall());
    act(() => {
      dispatchInstallPrompt('dismissed');
    });
    await waitFor(() => expect(result.current.canInstall).toBe(true));

    let outcome: InstallOutcome = 'unavailable';
    await act(async () => {
      outcome = await result.current.promptInstall();
    });
    expect(outcome).toBe('dismissed');
    expect(result.current.canInstall).toBe(true);
  });

  it('calls the native prompt exactly once per install attempt', async () => {
    const { result } = renderHook(() => usePwaInstall());
    let event!: InstallPromptStub;
    act(() => {
      event = dispatchInstallPrompt('accepted');
    });
    await waitFor(() => expect(result.current.canInstall).toBe(true));

    await act(async () => {
      await result.current.promptInstall();
    });
    expect(event.prompt).toHaveBeenCalledTimes(1);
  });

  it('returns unavailable when no prompt event exists', async () => {
    const { result } = renderHook(() => usePwaInstall());
    let outcome: InstallOutcome = 'accepted';
    await act(async () => {
      outcome = await result.current.promptInstall();
    });
    expect(outcome).toBe('unavailable');
  });

  it('marks the app installed after appinstalled', async () => {
    const { result } = renderHook(() => usePwaInstall());
    act(() => {
      dispatchInstallPrompt('accepted');
    });
    await waitFor(() => expect(result.current.canInstall).toBe(true));

    act(() => {
      window.dispatchEvent(new Event('appinstalled'));
    });
    await waitFor(() => expect(result.current.installed).toBe(true));
    expect(result.current.canInstall).toBe(false);
  });

  it('treats an already-standalone display mode as installed', () => {
    window.matchMedia = ((query: string) => ({
      matches: query.includes('standalone'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as typeof window.matchMedia;
    const { result } = renderHook(() => usePwaInstall());
    expect(result.current.installed).toBe(true);
    expect(result.current.canInstall).toBe(false);
    expect(result.current.iosInstallable).toBe(false);
  });

  it('offers the iOS instructions only on iOS without a Chromium prompt', () => {
    Object.defineProperty(window.navigator, 'userAgent', {
      value:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
      configurable: true,
    });
    const { result } = renderHook(() => usePwaInstall());
    expect(result.current.iosInstallable).toBe(true);
    expect(result.current.canInstall).toBe(false);
  });

  it('does not offer iOS instructions on desktop', () => {
    const { result } = renderHook(() => usePwaInstall());
    expect(result.current.iosInstallable).toBe(false);
  });
});
