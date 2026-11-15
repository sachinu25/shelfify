import { useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff, MailCheck } from 'lucide-react';
import { api, unwrap } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useDocumentTitle } from '../hooks';
import { Button, Field } from '../components/ui';
import libraryImg from '../Assets/Images/Library_Illustration_1.webp';

function AuthShell({ title, subtitle, children, footer }) {
  return (
    <div className="container-page grid min-h-[calc(100vh-68px)] items-center gap-12 py-10 lg:grid-cols-2">
      <div className="relative hidden h-full max-h-[680px] overflow-hidden rounded-[2rem] lg:block">
        <img src={libraryImg} alt="" className="size-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-ink/80 via-ink/20 to-transparent" />
        <div className="absolute bottom-10 left-10 right-10 text-paper">
          <p className="font-display text-3xl leading-snug">“There is no friend as loyal as a book.”</p>
          <p className="mt-2 text-sm text-paper/70">— Ernest Hemingway</p>
        </div>
      </div>
      <div className="mx-auto w-full max-w-md animate-fade-up">
        <h1 className="text-4xl sm:text-5xl">{title}</h1>
        {subtitle && <p className="mt-3 text-ink-soft">{subtitle}</p>}
        <div className="mt-8">{children}</div>
        {footer && <div className="mt-8 border-t border-line pt-6 text-sm text-ink-soft">{footer}</div>}
      </div>
    </div>
  );
}

function PasswordField({ label = 'Password', ...props }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Field label={label} type={show ? 'text' : 'password'} {...props} />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute right-3 top-[38px] rounded-md p-1 text-muted hover:text-ink"
        aria-label={show ? 'Hide password' : 'Show password'}
      >
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

const fieldErrors = (err) => Object.fromEntries((err.details || []).map((d) => [d.field, d.message]));
const passwordProblems = (p) => (p.length < 8 ? 'At least 8 characters' : !/[A-Za-z]/.test(p) || !/\d/.test(p) ? 'Use letters and at least one number' : '');

function useRedirectTarget() {
  const location = useLocation();
  const from = location.state?.from;
  return from ? `${from.pathname || '/'}${from.search || ''}` : '/';
}

export function Login() {
  useDocumentTitle('Sign in');
  const { login } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const target = useRedirectTarget();
  const [form, setForm] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!/^\S+@\S+\.\S+$/.test(form.email)) errs.email = 'Enter a valid email address';
    if (!form.password) errs.password = 'Password is required';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setLoading(true);
    setError('');
    try {
      const user = await login(form);
      toast.success(`Welcome back, ${user.name.split(' ')[0]}!`);
      navigate(target, { replace: true });
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to see your bag, wishlist and orders."
      footer={
        <>
          New to Shelfify?{' '}
          <Link to="/register" state={location.state} className="font-semibold text-accent hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        <Field label="Email" type="email" autoComplete="email" value={form.email} error={errors.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <PasswordField autoComplete="current-password" value={form.password} error={errors.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-sm font-medium text-accent hover:underline">
            Forgot password?
          </Link>
        </div>
        {error && !Object.keys(errors).length && <p className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">{error}</p>}
        <Button type="submit" size="lg" className="w-full" loading={loading}>
          Sign in
        </Button>
      </form>
    </AuthShell>
  );
}

export function Register() {
  useDocumentTitle('Create account');
  const { register } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const target = useRedirectTarget();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const errs = {};
    if (form.name.trim().length < 2) errs.name = 'Please enter your name';
    if (!/^\S+@\S+\.\S+$/.test(form.email)) errs.email = 'Enter a valid email address';
    const pw = passwordProblems(form.password);
    if (pw) errs.password = pw;
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setLoading(true);
    setError('');
    try {
      const user = await register(form);
      toast.success(`Welcome to Shelfify, ${user.name.split(' ')[0]}!`);
      navigate(target, { replace: true });
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="Create your account"
      subtitle="Save books, track orders and get recommendations tuned to your taste."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" state={location.state} className="font-semibold text-accent hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        <Field label="Full name" autoComplete="name" value={form.name} error={errors.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Field label="Email" type="email" autoComplete="email" value={form.email} error={errors.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <PasswordField
          autoComplete="new-password"
          value={form.password}
          error={errors.password}
          hint="At least 8 characters with a letter and a number"
          onChange={(e) => setForm({ ...form, password: e.target.value })}
        />
        {error && !Object.keys(errors).length && <p className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">{error}</p>}
        <Button type="submit" size="lg" className="w-full" loading={loading}>
          Create account
        </Button>
      </form>
    </AuthShell>
  );
}

export function ForgotPassword() {
  useDocumentTitle('Reset password');
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email)) return setError('Enter a valid email address');
    setLoading(true);
    setError('');
    try {
      await api.post('/auth/forgot-password', { email });
      setSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell title="Forgot your password?" subtitle="Enter your email and we’ll send you a secure reset link." footer={<Link to="/login" className="font-semibold text-accent hover:underline">Back to sign in</Link>}>
      {sent ? (
        <div className="rounded-2xl bg-forest-soft p-6 text-forest">
          <MailCheck className="mb-3 size-7" />
          <p className="font-semibold">Check your inbox</p>
          <p className="mt-1 text-sm">If an account exists for {email}, a reset link is on its way. It expires in 30 minutes.</p>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="space-y-4">
          <Field label="Email" type="email" autoComplete="email" value={email} error={error} onChange={(e) => setEmail(e.target.value)} />
          <Button type="submit" size="lg" className="w-full" loading={loading}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthShell>
  );
}

export function ResetPassword() {
  useDocumentTitle('Choose a new password');
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const token = params.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const errs = {};
    const pw = passwordProblems(password);
    if (pw) errs.password = pw;
    if (confirm !== password) errs.confirm = 'Passwords do not match';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setLoading(true);
    try {
      const data = unwrap(await api.post('/auth/reset-password', { token, password }));
      toast.success(data.message);
      navigate('/login', { replace: true });
    } catch (err) {
      setErrors({ form: err.message });
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <AuthShell title="Invalid reset link" subtitle="This link is missing its security token. Please request a new one." footer={<Link to="/forgot-password" className="font-semibold text-accent hover:underline">Request a new link</Link>} />
    );
  }

  return (
    <AuthShell title="Choose a new password" subtitle="For your security, all other sessions will be signed out.">
      <form onSubmit={submit} noValidate className="space-y-4">
        <PasswordField label="New password" autoComplete="new-password" value={password} error={errors.password} onChange={(e) => setPassword(e.target.value)} />
        <PasswordField label="Confirm password" autoComplete="new-password" value={confirm} error={errors.confirm} onChange={(e) => setConfirm(e.target.value)} />
        {errors.form && (
          <p className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
            {errors.form}{' '}
            <Link to="/forgot-password" className="font-semibold underline">
              Request a new link
            </Link>
          </p>
        )}
        <Button type="submit" size="lg" className="w-full" loading={loading}>
          Update password
        </Button>
      </form>
    </AuthShell>
  );
}
