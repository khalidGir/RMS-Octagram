import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_LOCALE, RTL_LOCALES, LOCALE_CODES } from '@rms/contracts';
import type { LocaleCode } from '@rms/contracts';
import type { MenuItemTranslation } from '@prisma/client';

@Injectable()
export class LocaleService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getTenantDefaultLocale(tenantId: string): Promise<string> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { defaultLocale: true },
    });
    return tenant?.defaultLocale ?? DEFAULT_LOCALE;
  }

  async setTenantDefaultLocale(tenantId: string, locale: LocaleCode): Promise<void> {
    this.assertValidLocale(locale);
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { defaultLocale: locale },
    });
  }

  async getUserPreferredLocale(tenantId: string, userId: string): Promise<string | null> {
    const membership = await this.prisma.tenantMembership.findFirst({
      where: { userId, tenantId },
      select: { preferredLocale: true },
    });
    return membership?.preferredLocale ?? null;
  }

  async setUserPreferredLocale(
    tenantId: string,
    userId: string,
    locale: LocaleCode | null,
  ): Promise<void> {
    if (locale !== null) {
      this.assertValidLocale(locale);
    }
    await this.prisma.tenantMembership.updateMany({
      where: { userId, tenantId },
      data: { preferredLocale: locale },
    });
  }

  /**
   * Resolve the effective locale for a user, following priority:
   * user preference > tenant default > DEFAULT_LOCALE
   */
  async resolveEffectiveLocale(
    tenantId: string,
    userId?: string,
  ): Promise<string> {
    if (userId) {
      const pref = await this.getUserPreferredLocale(tenantId, userId);
      if (pref) return pref;
    }
    return this.getTenantDefaultLocale(tenantId);
  }

  async isRtl(locale: string): Promise<boolean> {
    return RTL_LOCALES.includes(locale as any);
  }

  // ─── Menu Item Translations ─────────────────

  async getMenuItemTranslations(
    tenantId: string,
    menuItemId: string,
  ): Promise<MenuItemTranslation[]> {
    return this.prisma.menuItemTranslation.findMany({
      where: { tenantId, menuItemId },
      orderBy: { locale: 'asc' },
    });
  }

  async getTranslatedMenuItem(
    tenantId: string,
    menuItemId: string,
    locale: string,
  ): Promise<{ name: string; description: string | null; locale: string }> {
    // Try exact locale first
    let translation = await this.prisma.menuItemTranslation.findUnique({
      where: {
        tenantId_menuItemId_locale: { tenantId, menuItemId, locale },
      },
    });

    // Fall back to tenant default
    if (!translation) {
      const defaultLocale = await this.getTenantDefaultLocale(tenantId);
      if (defaultLocale !== locale) {
        translation = await this.prisma.menuItemTranslation.findUnique({
          where: {
            tenantId_menuItemId_locale: { tenantId, menuItemId, locale: defaultLocale },
          },
        });
      }
    }

    // Fall back to English
    if (!translation && locale !== 'en') {
      translation = await this.prisma.menuItemTranslation.findUnique({
        where: {
          tenantId_menuItemId_locale: { tenantId, menuItemId, locale: 'en' },
        },
      });
    }

    if (!translation) {
      throw new NotFoundException(`No translation found for menu item ${menuItemId} in locale ${locale}`);
    }

    return {
      name: translation.name,
      description: translation.description,
      locale: translation.locale,
    };
  }

  async upsertMenuItemTranslation(params: {
    tenantId: string;
    menuItemId: string;
    locale: string;
    name: string;
    description?: string;
  }): Promise<MenuItemTranslation> {
    this.assertValidLocale(params.locale);
    return this.prisma.menuItemTranslation.upsert({
      where: {
        tenantId_menuItemId_locale: {
          tenantId: params.tenantId,
          menuItemId: params.menuItemId,
          locale: params.locale,
        },
      },
      create: {
        tenantId: params.tenantId,
        menuItemId: params.menuItemId,
        locale: params.locale,
        name: params.name,
        description: params.description ?? null,
      },
      update: {
        name: params.name,
        description: params.description ?? null,
      },
    });
  }

  async deleteMenuItemTranslation(
    tenantId: string,
    menuItemId: string,
    locale: string,
  ): Promise<void> {
    await this.prisma.menuItemTranslation.deleteMany({
      where: { tenantId, menuItemId, locale },
    });
  }

  async getMenuTranslationsForLocale(
    tenantId: string,
    locale: string,
  ): Promise<MenuItemTranslation[]> {
    return this.prisma.menuItemTranslation.findMany({
      where: { tenantId, locale },
      orderBy: { menuItemId: 'asc' },
    });
  }

  private assertValidLocale(locale: string): void {
    if (!LOCALE_CODES.includes(locale as any)) {
      throw new BadRequestException(`Invalid locale: ${locale}. Must be one of: ${LOCALE_CODES.join(', ')}`);
    }
  }
}
