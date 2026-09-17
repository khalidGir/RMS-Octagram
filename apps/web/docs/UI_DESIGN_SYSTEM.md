# RMS UI Design System and Restaurant Theming

## 1. Design Direction

RMS uses a **modern hospitality** design language: warm, polished, approachable, and optimized for fast restaurant operations.

The system must not look like generic enterprise software, but operational clarity takes priority over decorative branding. Customer-facing pages may express a restaurant's identity strongly; staff interfaces remain consistent and predictable across tenants.

### Default visual character

- Warm off-white customer-facing backgrounds.
- Deep charcoal and slate staff surfaces.
- Terracotta as the default primary brand color.
- Muted gold as the default accent.
- Clean sans-serif typography.
- Softly rounded cards and controls.
- Large tablet-friendly touch targets.
- Strong contrast for bright and busy restaurant environments.
- Clear spacing and visual hierarchy rather than dense decoration.

## 2. Default Theme Tokens

The initial RMS theme should begin with these values. Final shades must be checked for WCAG contrast in their actual component context.

```css
:root {
  --brand-primary: #b4532a;
  --brand-primary-foreground: #ffffff;
  --brand-accent: #c08a2e;
  --brand-accent-foreground: #21170a;

  --surface-customer: #fffaf3;
  --surface-staff: #0f172a;
  --surface-card: #ffffff;
  --surface-muted: #f3eee7;

  --text-primary: #201a17;
  --text-secondary: #6b625c;
  --text-inverse: #f8fafc;
  --border-default: #ddd5cc;

  --radius-control: 0.625rem;
  --radius-card: 0.875rem;
  --radius-panel: 1rem;
}
```

The implementation may refine individual shades where contrast testing requires it. The semantic meaning and overall warm hospitality character should remain intact.

## 3. Customization Model

Restaurants receive controlled design tokens, not unrestricted CSS. This protects accessibility, application stability, security, and operational consistency.

### Tenant-level customization

A restaurant Owner may configure:

- Restaurant display name.
- Primary logo.
- Compact logo or icon.
- Primary brand color.
- Accent color.
- Light or dark customer storefront.
- Card and control roundness.
- One font from an approved font set.
- Storefront cover image.
- Receipt header and customer-facing contact information.

### Branch-level customization

The MVP should keep the visual identity at tenant level. A branch may override operational content such as its cover image, address, phone number, hours, and payment instructions.

Branch-specific brand colors or logos should be added only after a real multi-brand tenant requirement is confirmed.

### Explicitly unsupported customization

- Arbitrary tenant-provided CSS.
- Arbitrary JavaScript.
- Uploaded fonts.
- Custom HTML fragments.
- Replacing semantic status colors.
- Customizing component layout independently per tenant.
- Hiding required legal, payment, status, or accessibility information.

## 4. Theme Data Contract

The frontend-facing theme contract should use validated values:

```ts
export interface TenantTheme {
  logoUrl?: string;
  compactLogoUrl?: string;
  primaryColor: string;
  accentColor: string;
  storefrontMode: 'light' | 'dark';
  radius: 'square' | 'soft' | 'rounded';
  fontFamily: 'inter' | 'manrope' | 'source-sans';
  coverImageUrl?: string;
}
```

This interface is initially frontend-local. Moving it into `packages/contracts` requires coordination with the backend agent.

### Validation requirements

- Colors must be normalized six-digit hexadecimal values.
- URLs must reference approved private/public media records rather than arbitrary executable resources.
- Font and radius values must be approved enum members.
- Missing or invalid values fall back to the RMS defaults.
- Generated foreground colors must pass contrast requirements.
- Theme values must be escaped and applied only through known CSS custom properties.

## 5. Theme Resolution

Theme values resolve in this order:

1. Safe RMS defaults.
2. Validated tenant theme.
3. Allowed branch content overrides.
4. User accessibility preferences such as reduced motion and operating-system contrast settings.

Theme loading must not cause a prolonged flash of incorrect branding. Public pages should receive resolved theme tokens during server rendering where possible.

## 6. Branding by Product Surface

| Surface | Branding level | Rules |
| :--- | :--- | :--- |
| Customer menu | Strong | Logo, cover, brand colors, font, imagery, and storefront mode. |
| Table and pickup checkout | Strong | Preserve branding while emphasizing totals, payment instructions, and order state. |
| Customer order tracking | Moderate | Brand header and accents; semantic status remains fixed. |
| Staff login | Moderate | Logo, restaurant name, and restrained brand accents. |
| Owner/Manager dashboard | Light | Logo and primary accent only; charts remain semantically consistent. |
| POS | Minimal | Brand accent and compact logo; speed, readability, and touch accuracy dominate. |
| KDS | Very low | Compact logo optional; operational ticket/status colors are fixed. |
| Reports and print views | Restrained | Logo and subtle accent with high-contrast, ink-friendly content. |

## 7. Semantic Colors

The following meanings are system controlled and cannot be replaced by tenant branding:

| Meaning | Color family | Examples |
| :--- | :--- | :--- |
| Success / ready / paid | Green | Approved payment, ready ticket, saved setting. |
| Pending / warning | Amber | Awaiting verification, approaching stock threshold. |
| Error / rejected / urgent | Red | Rejected payment, cancelled order, critical stock. |
| Confirmed / informational | Blue | Confirmed order, neutral operational notice. |
| Inactive / unavailable / completed | Gray | Unavailable item, closed session, historical ticket. |

Semantic state must never be communicated by color alone. Pair it with text, icons, shape, or position.

## 8. Typography

Approved fonts:

- **Inter:** Default operational font with excellent UI density and number clarity.
- **Manrope:** Warmer customer-facing alternative.
- **Source Sans 3:** Highly readable alternative for content-heavy interfaces.

Rules:

- Use tabular numerals for prices, totals, timers, and quantities.
- Avoid font weights below 400 for important operational text.
- Maintain at least 16 px body text on customer mobile screens.
- KDS order numbers, elapsed time, and primary actions must be readable at a distance.
- Font selection must support all displayed languages before it is offered to tenants.

## 9. Layout and Responsiveness

### Target widths

- Customer mobile: 320-767 px.
- Staff tablet portrait: 768-1023 px.
- Staff tablet landscape and compact desktop: 1024-1439 px.
- Desktop management: 1440 px and above.

### Interaction requirements

- Primary touch targets should be at least 44 by 44 CSS pixels.
- POS and KDS priority actions should target 48 pixels or larger.
- Do not rely on hover for required functionality.
- Keep destructive actions visually separated from primary actions.
- Provide confirmation or reversible behavior for consequential actions.
- Preserve critical POS/KDS controls when the software keyboard opens.

## 10. Component Principles

Build reusable primitives in `packages/ui` and compose product-specific components in `apps/web`.

Core primitives should include:

- Button and icon button.
- Input, textarea, select, checkbox, radio, and switch.
- Dialog, drawer, popover, tooltip, and toast.
- Card, panel, divider, badge, and avatar/logo.
- Tabs, navigation rail, breadcrumb, and pagination.
- Data table and responsive list.
- Skeleton, empty state, error state, and retry action.
- Price, quantity stepper, order status, and connectivity indicator.

Product components such as menu-item cards, order tickets, payment-proof viewers, and KDS lanes belong in `apps/web` until a second consumer justifies promoting them.

## 11. Accessibility Requirements

- Meet WCAG 2.2 AA contrast for text and interactive controls.
- Support keyboard navigation and visible focus indicators.
- Use semantic HTML before adding ARIA.
- Honor `prefers-reduced-motion`.
- Avoid forced viewport zoom restrictions on customer pages.
- Announce asynchronous order/payment state changes appropriately.
- Provide meaningful alternative text for restaurant and menu imagery.
- Ensure theme colors cannot make text or focus states illegible.
- Test major workflows with keyboard-only navigation and a screen reader.

## 12. PWA and Connectivity UX

- Staff screens show persistent online, reconnecting, and offline state.
- Unsafe mutations are disabled when the server cannot acknowledge them.
- A locally preserved cart must be revalidated before submission.
- Install prompts must be helpful and dismissible.
- PWA standalone mode must retain navigation, sign-out, tenant, and branch context.
- Theme and shell assets may be cached; sensitive API responses and payment images must not be placed in an uncontrolled service-worker cache.

## 13. Theme Administration UX

The Owner-facing theme editor should provide:

- Logo and cover previews.
- Preset color suggestions.
- Validated color inputs.
- Storefront light/dark preview.
- Font and radius selection.
- Mobile and tablet preview modes.
- Contrast warnings with blocking validation for unsafe combinations.
- Reset-to-default behavior.
- Explicit save/publish rather than applying incomplete edits live.

Published theme changes should create an audit record through the backend.

## 14. Implementation Boundaries

- Theme resolution belongs in a dedicated provider near the web application root.
- Components consume semantic tokens such as `brand-primary` and `surface-card`; they do not read raw tenant settings directly.
- Do not scatter inline tenant color values through JSX.
- Do not use tenant primary color for operational state.
- Mock theme data must use the same frontend interface as the future API adapter.
- Backend persistence/API changes must be proposed to OpenCode; Codex must not edit backend-owned paths.

## 15. Design Acceptance Criteria

The theme system is acceptable when:

- A restaurant can recognize its customer storefront through its logo, colors, imagery, and approved font.
- POS and KDS remain visually consistent when switching between tenants.
- All status meanings remain understandable under every supported theme.
- Invalid or incomplete theme data safely falls back to RMS defaults.
- Customer ordering works at 320 px without horizontal scrolling.
- Staff workflows work at common tablet portrait and landscape widths.
- Keyboard, focus, reduced-motion, and contrast checks pass.
- No tenant-supplied value can inject CSS, HTML, or JavaScript.
