import { BrandMark } from '@/components/brand-mark';
import { LoginForm } from '@/components/login-form';

export const metadata = { title: 'Staff sign in' };

export default function LoginPage() {
  return (
    <main className="grid min-h-screen bg-[#f7f3ec] lg:grid-cols-[1.05fr_.95fr]">
      <section className="relative hidden overflow-hidden bg-[#121816] p-12 text-white lg:flex lg:flex-col">
        <div className="absolute -left-32 top-20 size-[520px] rounded-full bg-brand/25 blur-[120px]" />
        <div className="absolute -bottom-52 right-[-8rem] size-[620px] rounded-full border-[90px] border-white/[0.035]" />
        <div className="relative"><BrandMark /></div>
        <div className="relative my-auto max-w-xl"><p className="text-xs font-black uppercase tracking-[0.22em] text-brand-accent">One calm command center</p><h1 className="mt-5 text-5xl font-black leading-[1.05] tracking-[-0.055em]">Run every service with clarity.</h1><p className="mt-6 max-w-lg text-lg leading-8 text-white/55">Orders, payments, kitchen flow, and inventory—connected for every branch and every shift.</p><div className="mt-10 flex gap-7"><div><p className="text-2xl font-black">24</p><p className="mt-1 text-xs text-white/45">Live orders</p></div><div className="w-px bg-white/10" /><div><p className="text-2xl font-black">18 min</p><p className="mt-1 text-xs text-white/45">Avg. prep time</p></div><div className="w-px bg-white/10" /><div><p className="text-2xl font-black">2</p><p className="mt-1 text-xs text-white/45">Active branches</p></div></div></div>
        <p className="relative text-xs text-white/30">Built for hospitality teams in Ethiopia.</p>
      </section>
      <section className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-[440px]">
          <div className="mb-10 flex items-center text-[#121816] lg:hidden"><BrandMark onDark={false} /></div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-brand">Staff access</p><h2 className="mt-3 text-3xl font-black tracking-[-0.04em]">Welcome back.</h2><p className="mt-2 text-sm leading-6 text-ink-muted">Sign in to continue to your restaurant workspace.</p>
          <LoginForm />
          <div className="mt-8 flex items-center gap-3 text-xs text-ink-muted"><span className="h-px flex-1 bg-line" /><span>Secure staff access</span><span className="h-px flex-1 bg-line" /></div><p className="mt-6 text-center text-xs leading-5 text-ink-muted">Need access? Ask your restaurant owner or manager to invite you.</p>
        </div>
      </section>
    </main>
  );
}
