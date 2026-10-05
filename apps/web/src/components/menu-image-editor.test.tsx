import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type * as ReactNamespace from 'react';
import { LocaleProvider } from './locale-provider';
import { MenuImageEditor } from './menu-image-editor';
import type { MenuImageDraft } from '@/lib/menu-image';

// react-easy-crop needs real layout metrics jsdom cannot provide. The stub
// reports a deterministic crop area once mounted so confirm/rotate flows are
// testable without canvas or image decoding.
vi.mock('react-easy-crop', async () => {
  const React = await vi.importActual<typeof ReactNamespace>('react');
  return {
    default: (props: { onCropComplete: (area: { x: number; y: number; width: number; height: number }) => void }) => {
      const nodeRef = React.useRef<HTMLDivElement | null>(null);
      React.useEffect(() => {
        props.onCropComplete({ x: 10, y: 20, width: 50, height: 40 });
        // Signal that the crop area reached the editor, so tests can wait for
        // the parent's area state to be flushed before confirming.
        nodeRef.current?.setAttribute('data-reported', 'true');
      }, []);
      return React.createElement('div', { 'data-testid': 'cropper-stub', ref: nodeRef });
    },
  };
});

const draft = (previewUrl: string): MenuImageDraft => ({
  file: new File(['existing'], 'existing.jpg', { type: 'image/jpeg' }),
  previewUrl,
  crop: { x: 0, y: 0, width: 1, height: 1, rotation: 0 },
});

function renderEditor(value: MenuImageDraft | null = null) {
  const onChange = vi.fn();
  const utils = render(
    <LocaleProvider>
      <MenuImageEditor value={value} onChange={onChange} />
    </LocaleProvider>,
  );
  return { ...utils, onChange };
}

function fileInput(container: HTMLElement) {
  const input = container.querySelector('input[type="file"]');
  if (!input) throw new Error('file input not found');
  return input as HTMLInputElement;
}

function pick(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  fireEvent.change(input);
}

describe('MenuImageEditor', () => {
  beforeEach(() => {
    let sequence = 0;
    Object.defineProperty(URL, 'createObjectURL', {
      writable: true,
      configurable: true,
      value: vi.fn(() => `blob:owned-${++sequence}`),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      writable: true,
      configurable: true,
      value: vi.fn(),
    });
  });

  it('rejects an unsupported file type with a localized alert and no object URL', () => {
    const { container } = renderEditor();
    pick(fileInput(container), new File(['x'], 'anim.gif', { type: 'image/gif' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a JPEG, PNG, or WebP image.');
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('rejects a file larger than 10 MB with a localized alert', () => {
    const { container } = renderEditor();
    const oversized = new File(['x'], 'huge.jpg', { type: 'image/jpeg' });
    Object.defineProperty(oversized, 'size', { value: 10 * 1024 * 1024 + 1, configurable: true });
    pick(fileInput(container), oversized);
    expect(screen.getByRole('alert')).toHaveTextContent('The photo is larger than 10 MB. Choose a smaller file.');
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('clears a previous pick error once a valid file is chosen', () => {
    const { container } = renderEditor();
    pick(fileInput(container), new File(['x'], 'anim.gif', { type: 'image/gif' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    pick(fileInput(container), new File(['x'], 'good.jpg', { type: 'image/jpeg' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByTestId('cropper-stub')).toBeInTheDocument();
  });

  it('emits the crop as normalized fractions of the source image on confirm', async () => {
    const { container, onChange } = renderEditor();
    pick(fileInput(container), new File(['fake'], 'photo.jpg', { type: 'image/jpeg' }));
    await waitFor(() => expect(screen.getByTestId('cropper-stub')).toHaveAttribute('data-reported', 'true'));

    fireEvent.click(screen.getByRole('button', { name: 'Use this crop' }));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(onChange).toHaveBeenCalledWith({
      file: expect.any(File),
      previewUrl: 'blob:owned-1',
      crop: { x: 0.1, y: 0.2, width: 0.5, height: 0.4, rotation: 0 },
    });
  });

  it('applies a 90 degree rotation step to the emitted crop', async () => {
    const { container, onChange } = renderEditor();
    pick(fileInput(container), new File(['fake'], 'photo.jpg', { type: 'image/jpeg' }));
    await waitFor(() => expect(screen.getByTestId('cropper-stub')).toHaveAttribute('data-reported', 'true'));

    fireEvent.click(screen.getByRole('button', { name: 'Rotate' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use this crop' }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ crop: expect.objectContaining({ rotation: 90 }) })));
  });

  it('renders the existing preview and removes it through onChange(null)', () => {
    const { onChange } = renderEditor(draft('blob:preview-existing'));
    expect(screen.getByRole('img', { name: 'Menu photo preview' })).toHaveAttribute('src', 'blob:preview-existing');
    fireEvent.click(screen.getByRole('button', { name: 'Remove photo' }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('revokes the owned object URL when the crop dialog is cancelled', async () => {
    const { container } = renderEditor();
    pick(fileInput(container), new File(['fake'], 'photo.jpg', { type: 'image/jpeg' }));
    await waitFor(() => expect(screen.getByTestId('cropper-stub')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:owned-1'));
  });

  it('revokes every owned object URL on unmount', () => {
    const { container, unmount } = renderEditor();
    pick(fileInput(container), new File(['fake'], 'photo.jpg', { type: 'image/jpeg' }));
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);

    unmount();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:owned-1');
  });

  it('never revokes a preview URL it does not own', () => {
    const { onChange } = renderEditor(draft('blob:preview-existing'));
    fireEvent.click(screen.getByRole('button', { name: 'Remove photo' }));
    expect(onChange).toHaveBeenCalledWith(null);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });
});
