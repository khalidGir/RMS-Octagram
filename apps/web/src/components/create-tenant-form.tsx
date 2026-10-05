'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth-provider';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { Banner } from '@/components/ui/banner';
import { PageHeader } from '@/components/ui/page-header';
import { useLocale } from '@/components/locale-provider';
import { createTenant } from '@/lib/platform-api';

const PASSWORD_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,128}$/;

export function CreateTenantForm() {
  const { accessToken, csrfToken } = useAuth();
  const { tr } = useLocale();
  const router = useRouter();

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [ownerPhone, setOwnerPhone] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = tr('platform.nameRequired');
    if (!ownerPhone.trim()) next.ownerPhone = tr('platform.phoneRequired');
    if (!PASSWORD_RE.test(ownerPassword)) next.ownerPassword = tr('platform.passwordHint');
    if (confirmPassword !== ownerPassword) next.confirm = tr('platform.passwordMismatch');
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    if (!accessToken || !validate()) return;

    setSubmitting(true);
    try {
      const result = await createTenant(
        {
          name: name.trim(),
          slug: slug.trim() || undefined,
          ownerPhone: ownerPhone.trim(),
          ownerPassword,
          ownerName: ownerName.trim() || undefined,
        },
        accessToken,
        csrfToken,
      );
      router.push(`/platform/tenants/${result.tenant.id}`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : tr('platform.createError'));
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-[760px]">
      <PageHeader
        eyebrow={tr('platform.eyebrow')}
        title={tr('platform.newRestaurantTitle')}
        description={tr('platform.newRestaurantDesc')}
      />

      {formError && (
        <Banner variant="danger" title={tr('platform.createBannerTitle')} onDismiss={() => setFormError(null)} className="mt-5">
          {formError}
        </Banner>
      )}

      <form
        onSubmit={handleSubmit}
        className="mt-6 grid gap-4 rounded-panel border border-line bg-white p-6 shadow-card sm:grid-cols-2"
      >
        <div className="sm:col-span-2">
          <TextField
            label={tr('platform.nameLabel')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={errors.name}
            placeholder={tr('platform.namePlaceholder')}
            autoComplete="organization"
          />
        </div>

        <TextField
          label={tr('platform.slugLabel')}
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          error={errors.slug}
          hint={tr('platform.slugHint')}
          placeholder="buna-house"
        />

        <TextField
          label={tr('platform.ownerNameLabel')}
          value={ownerName}
          onChange={(e) => setOwnerName(e.target.value)}
          error={errors.ownerName}
          hint={tr('platform.ownerNameHint')}
          placeholder={tr('platform.ownerNamePlaceholder')}
          autoComplete="name"
        />

        <TextField
          label={tr('platform.phoneLabel')}
          value={ownerPhone}
          onChange={(e) => setOwnerPhone(e.target.value)}
          error={errors.ownerPhone}
          placeholder="0911 234 567"
          inputMode="tel"
          autoComplete="tel"
        />

        <TextField
          label={tr('platform.passwordLabel')}
          type="password"
          value={ownerPassword}
          onChange={(e) => setOwnerPassword(e.target.value)}
          error={errors.ownerPassword}
          hint={tr('platform.passwordHint')}
          autoComplete="new-password"
        />

        <div className="sm:col-span-2">
          <TextField
            label={tr('platform.confirmLabel')}
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            error={errors.confirm}
            autoComplete="new-password"
          />
        </div>

        <div className="flex justify-end gap-3 pt-2 sm:col-span-2">
          <Button type="button" variant="secondary" onClick={() => router.push('/platform')}>
            {tr('common.cancel')}
          </Button>
          <Button type="submit" loading={submitting}>
            {tr('platform.createBtn')}
          </Button>
        </div>
      </form>
    </div>
  );
}
