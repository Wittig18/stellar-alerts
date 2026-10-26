'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { DIDSignInButton } from '@/components/DIDSignInButton';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';
const RESEND_COOLDOWN_SECONDS = 30;

function SignInContent() {
  const { data: session } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const expired = searchParams.get('error') === 'expired';

  const [email, setEmail] = useState('');
  const [sentEmail, setSentEmail] = useState('');
  const [devMagicUrl, setDevMagicUrl] = useState<string | null>(null);
  const [step, setStep] = useState<'input' | 'sent'>('input');
  const [error, setError] = useState<string | null>(
    expired ? 'Your magic link is invalid or has expired. Request a new one below.' : null,
  );
  const [isSending, setIsSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (session) router.replace('/dashboard');
  }, [session, router]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function requestLink(e?: React.FormEvent) {
    e?.preventDefault();
    const target = (step === 'sent' ? sentEmail : email).trim();
    if (!target || isSending) return;

    setIsSending(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE_URL}/auth/request-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: target }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setSentEmail(target);
        setStep('sent');
        setCooldown(RESEND_COOLDOWN_SECONDS);
        setDevMagicUrl(data.token ? `${window.location.origin}/verify?token=${data.token}` : null);
      } else {
        setError(data.error?.message || data.error || 'Failed to send magic link.');
      }
    } catch (err) {
      console.error('Magic link request error:', err);
      setError('Could not reach the authentication service. Please try again.');
    } finally {
      setIsSending(false);
    }
  }

  return (
    <div className="w-full max-w-md bg-[#0a0a14]/90 backdrop-blur-2xl border border-white/10 rounded-3xl p-8 sm:p-10 shadow-[0_0_80px_rgba(0,0,0,0.8)] relative overflow-hidden">
      <div className="absolute top-0 right-0 w-40 h-40 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none"></div>

      {step === 'input' ? (
        <div className="space-y-6 relative">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-white tracking-tight">Sign in to StellarAlerts</h1>
            <p className="text-gray-400 text-sm mt-2">No password needed. We&apos;ll email you a one-time magic link.</p>
          </div>

          <form onSubmit={requestLink} className="space-y-4">
            <div>
              <label htmlFor="signin-email" className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
                Email address
              </label>
              <input
                id="signin-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                className="w-full px-5 py-3.5 rounded-xl bg-[#141422] border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500/60 text-sm font-medium transition-all"
              />
            </div>

            {error && (
              <p role="alert" className="text-xs text-red-400 font-medium">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={isSending}
              className="w-full py-3.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-bold text-sm shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {isSending ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              ) : (
                'Send Magic Link'
              )}
            </button>
          </form>

          <div className="flex items-center gap-3 text-[10px] uppercase tracking-widest text-gray-500">
            <span className="h-px flex-1 bg-white/10"></span>
            or use a wallet
            <span className="h-px flex-1 bg-white/10"></span>
          </div>

          <DIDSignInButton />
        </div>
      ) : (
        <div className="space-y-6 text-center relative">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-white shadow-xl mx-auto">
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>

          <div>
            <h1 className="text-xl font-bold text-white tracking-tight">Check your email</h1>
            <p className="text-sm text-gray-300 mt-2">
              We sent a magic login link to <strong className="text-cyan-400 font-mono break-all">{sentEmail}</strong>.
              Open it on this device to sign in automatically.
            </p>
          </div>

          {devMagicUrl && (
            <Link
              href={devMagicUrl}
              className="block text-xs text-amber-300 border border-amber-500/30 bg-amber-500/10 rounded-xl px-4 py-3 break-all hover:bg-amber-500/20 transition-colors"
            >
              Dev mode: open magic link directly
            </Link>
          )}

          {error && (
            <p role="alert" className="text-xs text-red-400 font-medium">
              {error}
            </p>
          )}

          <div className="space-y-3">
            <button
              type="button"
              onClick={() => requestLink()}
              disabled={cooldown > 0 || isSending}
              className="w-full py-3 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-white font-semibold text-sm transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {cooldown > 0 ? `Resend link in ${cooldown}s` : 'Resend magic link'}
            </button>
            <button
              type="button"
              onClick={() => {
                setStep('input');
                setError(null);
                setDevMagicUrl(null);
              }}
              className="text-xs text-gray-400 hover:text-white underline underline-offset-4 cursor-pointer"
            >
              Use a different email address
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SignInPage() {
  return (
    <div className="min-h-screen bg-[#030307] flex items-center justify-center p-6 relative overflow-hidden">
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-[30%] left-[30%] w-[40vw] h-[40vw] rounded-full bg-cyan-600/15 blur-[160px] mix-blend-screen"></div>
        <div className="absolute bottom-[20%] right-[20%] w-[35vw] h-[35vw] rounded-full bg-blue-600/15 blur-[160px] mix-blend-screen"></div>
      </div>

      <div className="relative z-10 w-full flex justify-center">
        <Suspense
          fallback={
            <div className="w-full max-w-md bg-[#0a0a14] border border-white/10 rounded-3xl p-10 text-center">
              <div className="w-10 h-10 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
            </div>
          }
        >
          <SignInContent />
        </Suspense>
      </div>
    </div>
  );
}
