'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth-provider';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { Banner } from '@/components/ui/banner';
import { PageHeader } from '@/components/ui/page-header';
import { createTenant } from '@/lib/platform-api';

const PASSWORD_HINT = 'At least 8 characters with an uppercase letter, a lowercase letter, and a digit.';
const PASSWORD_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,128}$/;

export function CreateTenantForm() {
  const { accessToken, csrfToken } = useAuth();
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
    if (!name.trim()) next.name = 'Restaurant name is required';
    if (!ownerPhone.trim()) next.ownerPhone = 'Owner phone is required';
    if (!PASSWORD_RE.test(ownerPassword)) next.ownerPassword = PASSWORD_HINT;
    if (confirmPassword !== ownerPassword) next.confirm = 'Passwords do not match';
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
      setFormError(err instanceof Error ? err.message : 'Could not create the restaurant. Please try again.');
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-[760px]">
      <PageHeader
        eyebrow="Platform"
        title="New restaurant"
        description="Provision a tenant account and its first owner."
      />

      {formError && (
        <Banner variant="danger" title="Could not create restaurant" onDismiss={() => setFormError(null)} className="mt-5">
          {formError}
        </Banner>
      )}

      <form
        onSubmit={handleSubmit}
        className="mt-6 grid gap-4 rounded-panel border border-line bg-white p-6 shadow-card sm:grid-cols-2"
      >
        <div className="sm:col-span-2">
          <TextField
            label="Restaurant name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={errors.name}
            placeholder="Buna House"
            autoComplete="organization"
          />
        </div>

        <TextField
          label="Slug (optional)"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          error={errors.slug}
          hint="Leave empty to generate it from the name."
          placeholder="buna-house"
        />

        <TextField
          label="Owner name (optional)"
          value={ownerName}
          onChange={(e) => setOwnerName(e.target.value)}
          error={errors.ownerName}
          hint="Leave empty to use Owner plus the last 4 phone digits."
          placeholder="Abebe Kebede"
          autoComplete="name"
        />

        <TextField
          label="Owner phone"
          value={ownerPhone}
          onChange={(e) => setOwnerPhone(e.target.value)}
          error={errors.ownerPhone}
          placeholder="0911 234 567"
          inputMode="tel"
          autoComplete="tel"
        />

        <TextField
          label="Owner password"
          type="password"
          value={ownerPassword}
          onChange={(e) => setOwnerPassword(e.target.value)}
          error={errors.ownerPassword}
          hint={PASSWORD_HINT}
          autoComplete="new-password"
        />

        <div className="sm:col-span-2">
          <TextField
            label="Confirm password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            error={errors.confirm}
            autoComplete="new-password"
          />
        </div>

        <div className="flex justify-end gap-3 pt-2 sm:col-span-2">
          <Button type="button" variant="secondary" onClick={() => router.push('/platform')}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting}>
            Create restaurant
          </Button>
        </div>
      </form>
    </div>
  );
}
