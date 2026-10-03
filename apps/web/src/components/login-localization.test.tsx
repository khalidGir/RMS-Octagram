import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LocaleProvider } from './locale-provider';
import { LoginForm } from './login-form';
import { LoginHeading, LoginHero, LoginHeroFootnote } from './login-copy';

const loginMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

vi.mock('./auth-provider', () => ({
  useAuth: () => ({ login: loginMock }),
}));

function renderLoginForm() {
  return render(
    <LocaleProvider>
      <LoginForm />
    </LocaleProvider>,
  );
}

function fillCredentials(phone: string, labels: { phone: string; password: string }) {
  fireEvent.change(screen.getByLabelText(labels.phone), { target: { value: phone } });
  fireEvent.change(screen.getByLabelText(labels.password), { target: { value: 'secret123' } });
}

const englishLabels = { phone: 'Phone number', password: 'Password' };
const amharicLabels = { phone: 'ስልክ ቁጥር', password: 'የይለፍ ቃል' };

beforeEach(() => {
  loginMock.mockReset();
  localStorage.clear();
  document.cookie = 'rms-locale=; path=/; max-age=0';
  document.documentElement.lang = 'en';
  document.documentElement.dir = 'ltr';
});

describe('login localization', () => {
  it('keeps the English labels and button text', () => {
    renderLoginForm();
    expect(screen.getByLabelText('Phone number')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in to RestaurantMS' })).toBeInTheDocument();
  });

  it('renders the form in Amharic when Amharic is active', () => {
    localStorage.setItem('rms-locale', 'am');
    renderLoginForm();
    expect(screen.getByLabelText('ስልክ ቁጥር')).toBeInTheDocument();
    expect(screen.getByLabelText('የይለፍ ቃል')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ወደ RestaurantMS ይግቡ' })).toBeInTheDocument();
  });

  it('keeps the English password reveal labels unchanged', () => {
    renderLoginForm();
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(screen.getByRole('button', { name: 'Hide password' })).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text');
  });

  it('localizes the password reveal control in Amharic', () => {
    localStorage.setItem('rms-locale', 'am');
    renderLoginForm();
    fireEvent.click(screen.getByRole('button', { name: 'የይለፍ ቃል አሳይ' }));
    expect(screen.getByRole('button', { name: 'የይለፍ ቃል ደብቅ' })).toBeInTheDocument();
    expect(screen.getByLabelText('የይለፍ ቃል')).toHaveAttribute('type', 'text');
  });

  it('localizes the password reveal control in Arabic', () => {
    localStorage.setItem('rms-locale', 'ar');
    renderLoginForm();
    fireEvent.click(screen.getByRole('button', { name: 'إظهار كلمة المرور' }));
    expect(screen.getByRole('button', { name: 'إخفاء كلمة المرور' })).toBeInTheDocument();
    expect(screen.getByLabelText('كلمة المرور')).toHaveAttribute('type', 'text');
  });

  it('shows the invalid phone validation message in English', () => {
    renderLoginForm();
    fillCredentials('not-a-phone', englishLabels);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in to RestaurantMS' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Enter a valid Ethiopian mobile number (e.g. 0911 234 567).',
    );
    expect(loginMock).not.toHaveBeenCalled();
  });

  it('shows the invalid phone validation message in Amharic', () => {
    localStorage.setItem('rms-locale', 'am');
    renderLoginForm();
    fillCredentials('not-a-phone', amharicLabels);
    fireEvent.click(screen.getByRole('button', { name: 'ወደ RestaurantMS ይግቡ' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'ትክክለኛ የኢትዮጵያ ሞባይል ቁጥር ያስገቡ (ለምሳሌ 0911 234 567)።',
    );
    expect(loginMock).not.toHaveBeenCalled();
  });

  it('localizes the sign-in failure fallback in English', async () => {
    loginMock.mockRejectedValueOnce(new Error('network down'));
    renderLoginForm();
    fillCredentials('0911234567', englishLabels);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in to RestaurantMS' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Sign-in failed. Check your connection and try again.',
      ),
    );
  });

  it('renders the login page copy in Arabic', () => {
    localStorage.setItem('rms-locale', 'ar');
    render(
      <LocaleProvider>
        <LoginHero />
        <LoginHeroFootnote />
        <LoginHeading />
      </LocaleProvider>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'أدِر كل خدمة بوضوح.' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'مرحباً بعودتك.' })).toBeInTheDocument();
    expect(screen.getByText('دخول الموظفين')).toBeInTheDocument();
    expect(screen.getByText('صُنع لفرق الضيافة في إثيوبيا.')).toBeInTheDocument();
  });

  it('keeps the English login page copy unchanged', () => {
    render(
      <LocaleProvider>
        <LoginHero />
        <LoginHeroFootnote />
        <LoginHeading />
      </LocaleProvider>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Run every service with clarity.' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Welcome back.' })).toBeInTheDocument();
    expect(screen.getByText('Staff access')).toBeInTheDocument();
    expect(screen.getByText('Built for hospitality teams in Ethiopia.')).toBeInTheDocument();
  });
});
