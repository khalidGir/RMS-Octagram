import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MenuItemPhoto } from './menu-item-photo';

const image = { thumbnailUrl: 'https://cdn/thumb.webp', standardUrl: 'https://cdn/standard.webp', highResolutionUrl: 'https://cdn/high.webp', width: 1280, height: 960 };

describe('MenuItemPhoto', () => {
  it('renders responsive CDN image data with stable dimensions', () => {
    render(<MenuItemPhoto image={image} name="Shiro Wot" />);
    const photo = screen.getByRole('img', { name: 'Shiro Wot' });
    expect(photo).toHaveAttribute('src', image.thumbnailUrl);
    expect(photo).toHaveAttribute('width', '1280');
    expect(photo).toHaveAttribute('height', '960');
  });

  it('renders initials when no image exists', () => {
    render(<MenuItemPhoto name="Shiro Wot" />);
    expect(screen.getByRole('img', { name: 'Shiro Wot' })).toHaveTextContent('SW');
  });

  it('falls back without breaking the card when the CDN image fails', () => {
    render(<MenuItemPhoto image={image} name="Buna" />);
    fireEvent.error(screen.getByRole('img', { name: 'Buna' }));
    expect(screen.getByRole('img', { name: 'Buna' })).toHaveTextContent('B');
  });
});
