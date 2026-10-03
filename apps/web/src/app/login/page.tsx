import { BrandMark } from '@/components/brand-mark';
import { LoginForm } from '@/components/login-form';
import { LanguagePicker } from '@/components/language-picker';
import { LoginFootnote, LoginHeading, LoginHero, LoginHeroFootnote } from '@/components/login-copy';

export const metadata = { title: 'Staff sign in' };

export default function LoginPage() {
  return (
    <main className="grid min-h-screen bg-canvas lg:grid-cols-[1.05fr_.95fr]">
      <section className="relative hidden overflow-hidden bg-dark-deep p-12 text-white lg:flex lg:flex-col">
        <div className="absolute -start-32 top-20 size-[520px] rounded-full bg-brand/20 blur-[120px]" />
        <div className="absolute -bottom-52 end-[-8rem] size-[620px] rounded-full border-[90px] border-white/[0.025]" />
        <div className="relative"><BrandMark name="RestaurantMS" /></div>
        <LoginHero />
        <LoginHeroFootnote />
      </section>
      <section className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-[440px]">
          <div className="mb-10 flex items-center justify-between gap-4 text-ink"><span className="lg:hidden"><BrandMark onDark={false} /></span><LanguagePicker compact className="ms-auto" /></div>
          <LoginHeading />
          <LoginForm />
          <LoginFootnote />
        </div>
      </section>
    </main>
  );
}
