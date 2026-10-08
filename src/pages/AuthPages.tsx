import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ArrowRight, CodeXml, LockKeyhole, ShieldCheck } from 'lucide-react'
import { supabase, configured, configurationError } from '../lib/supabase'
import { loginSchema, passwordSchema } from '../lib/validation'
import { ErrorBox, Field, Notice, Spinner, Success } from '../components/ui'
import { useAuth } from '../auth/AuthProvider'

export function SetupPage() {
  return (
    <div className="setup">
      <CodeXml size={38} />
      <h1>DevCare is ready to connect.</h1>
      <p>Configure your Supabase project to start using the support portal.</p>
      {configurationError && <ErrorBox error={configurationError} />}
      <ol>
        <li>
          Copy <code>.env.example</code> to <code>.env.local</code>.
        </li>
        <li>Set the Supabase URL and publishable key.</li>
        <li>Apply the migrations and deploy the Edge Functions.</li>
        <li>
          Follow <code>DEPLOYMENT.md</code> to create the first administrator.
        </li>
        <li>
          Restart <code>npm run dev</code>.
        </li>
      </ol>
      <Notice>
        This application uses real Supabase data. No sample client records or production credentials
        are bundled.
      </Notice>
    </div>
  )
}
export function AuthPage({ mode }: { mode: 'login' | 'forgot' | 'reset' | 'invite' }) {
  const { session, profile, loading, refresh } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)
  const verified = useRef(false)
  const login = useForm<z.infer<typeof loginSchema>>({ resolver: zodResolver(loginSchema) })
  const emailSchema = z.object({ email: z.email('Enter a valid email address.') })
  const forgot = useForm<z.infer<typeof emailSchema>>({ resolver: zodResolver(emailSchema) })
  const password = useForm<z.infer<typeof passwordSchema>>({
    resolver: zodResolver(passwordSchema),
  })
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const hash = new URLSearchParams(location.hash.slice(1))
    const linkError = params.get('error_description') ?? hash.get('error_description')
    if (linkError) {
      queueMicrotask(() => setError(linkError))
      return
    }
    const token = params.get('token_hash')
    if (token && !verified.current && (mode === 'reset' || mode === 'invite')) {
      verified.current = true
      queueMicrotask(() => setVerifying(true))
      void supabase.auth
        .verifyOtp({ token_hash: token, type: mode === 'invite' ? 'invite' : 'recovery' })
        .then(async ({ error }) => {
          if (error) setError('This link is invalid or expired. Request a fresh email.')
          else {
            await refresh()
          }
          navigate(location.pathname, { replace: true })
          setVerifying(false)
        })
    }
  }, [location.search, location.hash, location.pathname, mode, refresh, navigate])
  if (!configured) return <SetupPage />
  if (mode === 'login' && session && profile?.active) return <Navigate to="/" replace />
  const title = {
    login: 'Welcome back.',
    forgot: 'Forgot your password?',
    reset: 'Set a new password.',
    invite: 'Welcome to DevCare.',
  }[mode]
  const subtitle = {
    login: 'Sign in to your client support workspace.',
    forgot: 'We’ll send you a secure password reset link.',
    reset: 'Choose a strong password for your account.',
    invite: 'Accept your invitation and secure your account.',
  }[mode]
  return (
    <div className="auth-layout">
      <aside className="auth-brand">
        <Link className="brand" to="/">
          <span className="brand-icon">
            <CodeXml />
          </span>
          DevCare<span className="brand-dot">.</span>
        </Link>
        <div>
          <span className="eyebrow light">LESS CHAT. MORE CLARITY.</span>
          <h1>
            Good projects deserve
            <br />
            great support.
          </h1>
          <p>
            One place for your projects, conversations, and the little things that make a big
            difference.
          </p>
          <div className="brand-rule" />
          <div className="auth-promise">
            <ShieldCheck size={22} />
            <span>
              A private workspace for you
              <br />
              and your developer.
            </span>
          </div>
        </div>
        <small>Client Support & Project Ticketing System</small>
      </aside>
      <main id="main-content" className="auth-main">
        <div className="auth-card">
          <div className="auth-mobile-brand">
            <CodeXml /> DevCare
          </div>
          <div className="auth-lock">
            <LockKeyhole size={24} />
          </div>
          <h1>{title}</h1>
          <p className="muted">{subtitle}</p>
          {Boolean(error) && <ErrorBox error={error} />} {success && <Success>{success}</Success>}
          {mode === 'login' && (
            <form
              onSubmit={login.handleSubmit(async (values) => {
                setError(null)
                const { error } = await supabase.auth.signInWithPassword(values)
                if (error) setError(error.message)
                else {
                  await refresh()
                  navigate('/', { replace: true })
                }
              })}
            >
              <Field label="Email address" error={login.formState.errors.email?.message}>
                <input type="email" autoComplete="email" {...login.register('email')} />
              </Field>
              <Field label="Password" error={login.formState.errors.password?.message}>
                <input
                  type="password"
                  autoComplete="current-password"
                  {...login.register('password')}
                />
              </Field>
              <Link className="forgot-link" to="/forgot-password">
                Forgot password?
              </Link>
              <button className="btn green full" disabled={login.formState.isSubmitting}>
                Sign In
                <ArrowRight size={18} />
              </button>
              <p className="auth-footnote">
                Access is by invitation. Contact your developer if you need an account.
              </p>
            </form>
          )}
          {mode === 'forgot' && (
            <form
              onSubmit={forgot.handleSubmit(async ({ email }) => {
                setError(null)
                const result = await supabase.auth.resetPasswordForEmail(email, {
                  redirectTo: `${window.location.origin}/reset-password`,
                })
                if (result.error) setError(result.error.message)
                else
                  setSuccess(
                    'If an account exists for this address, a reset email is on its way. Check your inbox and spam folder.',
                  )
              })}
            >
              <Field label="Email address" error={forgot.formState.errors.email?.message}>
                <input type="email" autoComplete="email" {...forgot.register('email')} />
              </Field>
              <button className="btn green full" disabled={forgot.formState.isSubmitting}>
                Send Reset Link
                <ArrowRight size={18} />
              </button>
            </form>
          )}
          {(mode === 'reset' || mode === 'invite') &&
            (loading || verifying ? (
              <Spinner />
            ) : session ? (
              <form
                onSubmit={password.handleSubmit(async ({ password: newPassword }) => {
                  setError(null)
                  const { error } = await supabase.auth.updateUser({ password: newPassword })
                  if (error) setError(error.message)
                  else {
                    await refresh()
                    navigate('/', { replace: true })
                  }
                })}
              >
                <Field
                  label="New password"
                  error={password.formState.errors.password?.message}
                  hint="At least 12 characters. A long, unique passphrase works well."
                >
                  <input
                    type="password"
                    autoComplete="new-password"
                    {...password.register('password')}
                  />
                </Field>
                <Field label="Confirm password" error={password.formState.errors.confirm?.message}>
                  <input
                    type="password"
                    autoComplete="new-password"
                    {...password.register('confirm')}
                  />
                </Field>
                <button className="btn green full" disabled={password.formState.isSubmitting}>
                  {mode === 'invite' ? 'Accept Invitation' : 'Save Password'}
                  <ArrowRight size={18} />
                </button>
              </form>
            ) : (
              <Notice>
                Open the secure link in your email to continue.{' '}
                {mode === 'reset' ? (
                  <Link to="/forgot-password">Request another reset link.</Link>
                ) : (
                  <span>
                    Already accepted an invitation?{' '}
                    <Link to="/forgot-password">Set your password using a fresh reset link.</Link>{' '}
                    Otherwise, ask your developer for a new invitation.
                  </span>
                )}
              </Notice>
            ))}
          {mode !== 'login' && (
            <Link className="back-link" to="/login">
              Back to Sign In
            </Link>
          )}
          <div className="secure-footer">
            <ShieldCheck size={15} />
            Secure access · Your projects stay private
          </div>
        </div>
      </main>
    </div>
  )
}
