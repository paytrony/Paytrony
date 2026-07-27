import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Send, Gamepad2, Wallet, Compass, MessageCircle, Twitch, Github, MoreHorizontal } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const search = z.object({
  mode: z.enum(["signin", "signup"]).optional().default("signin"),
  ref: z.string().optional(),
});

export const Route = createFileRoute("/auth")({
  validateSearch: search,
  component: AuthPage,
});

const COMING_SOON = [
  { label: "Telegram", Icon: Send },
  { label: "Steam", Icon: Gamepad2 },
  { label: "MetaMask", Icon: Wallet },
  { label: "Brave", Icon: Compass },
  { label: "Discord", Icon: MessageCircle },
  { label: "Twitch", Icon: Twitch },
  { label: "GitHub", Icon: Github },
  { label: "More", Icon: MoreHorizontal },
];

type Step = "email" | "otp";

function AuthPage() {
  const { mode, ref } = Route.useSearch();
  const navigate = useNavigate();
  const [isSignup, setIsSignup] = useState(mode === "signup");
  const [email, setEmail] = useState("");
  const [refCode, setRefCode] = useState(ref ?? "");
  const [step, setStep] = useState<Step>("email");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const otpRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setIsSignup(mode === "signup"); }, [mode]);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard" });
    });
  }, [navigate]);

  useEffect(() => {
    if (step !== "otp" || resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [step, resendIn]);

  useEffect(() => { if (step === "otp") otpRef.current?.focus(); }, [step]);

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    if (!email) return;
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: isSignup,
          emailRedirectTo: window.location.origin,
          data: isSignup && refCode ? { ref: refCode.trim().toUpperCase() } : undefined,
        },
      });
      if (error) throw error;
      setStep("otp");
      setResendIn(30);
      toast.success("Code sent — check your email");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to send code";
      // Friendlier hint when signing in an unknown email.
      if (!isSignup && /signups.*disabled|user.*not.*found|invalid/i.test(msg)) {
        toast.error("No account for that email. Try creating one.");
      } else {
        toast.error(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    if (code.length < 6) return toast.error("Enter the code from your email");
    setLoading(true);
    try {
      const { error } = await supabase.auth.verifyOtp({
        email,
        token: code.trim(),
        type: "email",
      });
      if (error) throw error;
      toast.success(isSignup ? "Account created!" : "Signed in");
      navigate({ to: "/dashboard" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Invalid or expired code");
    } finally {
      setLoading(false);
    }
  }


  return (
    <div className="relative flex min-h-screen items-center justify-center px-4 py-10">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,hsl(var(--primary)/0.12),transparent_60%)]" />
      <div className="relative w-full max-w-md">
        <Link to="/" className="mb-5 block text-center font-mono text-xs text-muted-foreground hover:text-foreground">← PayTrony</Link>
        <div className="rounded-2xl border border-border bg-card/95 p-7 shadow-2xl backdrop-blur">
          <h1 className="text-center text-2xl font-bold tracking-tight">
            {step === "otp"
              ? "Enter your code"
              : isSignup
              ? "Create your PayTrony account"
              : "Welcome to PayTrony"}
          </h1>

          {step === "email" && (
            <form onSubmit={sendCode} className="mt-6 space-y-3">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email address"
                className="w-full rounded-lg border border-input bg-input/60 px-3.5 py-2.5 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
              />
              {isSignup && (
                <input
                  value={refCode}
                  onChange={(e) => setRefCode(e.target.value)}
                  placeholder="Referral code (optional)"
                  className="w-full rounded-lg border border-input bg-input/60 px-3.5 py-2.5 font-mono text-sm uppercase outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
                />
              )}
              <button
                type="submit"
                disabled={loading || !email}
                className="glow w-full rounded-lg bg-primary py-2.5 font-medium text-primary-foreground disabled:opacity-50"
              >
                {loading ? "Sending…" : "Send code"}
              </button>
              <p className="text-center text-[11px] text-muted-foreground">
                We'll email you a 6-digit code. No password needed.
              </p>
            </form>
          )}

          {step === "otp" && (
            <form onSubmit={verifyCode} className="mt-6 space-y-3">
              <p className="text-center text-sm text-muted-foreground">
                Sent to <span className="text-foreground">{email}</span>
              </p>
              <input
                ref={otpRef}
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="123456"
                className="w-full rounded-lg border border-input bg-input/60 px-3.5 py-3 text-center font-mono text-lg tracking-[0.5em] outline-none focus:ring-2 focus:ring-ring"
              />
              <button
                type="submit"
                disabled={loading || code.length < 6}
                className="glow w-full rounded-lg bg-primary py-2.5 font-medium text-primary-foreground disabled:opacity-50"
              >
                {loading ? "Verifying…" : "Verify & continue"}
              </button>
              <div className="flex items-center justify-between text-xs">
                <button
                  type="button"
                  onClick={() => { setStep("email"); setCode(""); }}
                  className="text-muted-foreground hover:text-foreground"
                >
                  ← Change email
                </button>
                <button
                  type="button"
                  disabled={resendIn > 0 || loading}
                  onClick={() => sendCode()}
                  className="text-primary hover:underline disabled:text-muted-foreground disabled:no-underline"
                >
                  {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend code"}
                </button>
              </div>
            </form>
          )}

          <div className="my-5 flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-[11px] font-medium tracking-wider text-muted-foreground">OR</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <TooltipProvider delayDuration={100}>
            <div className="grid grid-cols-4 gap-2">
              {COMING_SOON.map(({ label, Icon }) => (
                <Tooltip key={label}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      disabled
                      aria-label={`${label} (coming soon)`}
                      className="flex aspect-square items-center justify-center rounded-lg border border-border bg-muted/40 text-muted-foreground opacity-70 cursor-not-allowed"
                    >
                      <Icon className="h-5 w-5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{label} · Coming soon</TooltipContent>
                </Tooltip>
              ))}
            </div>
          </TooltipProvider>

          <div className="mt-5 text-center text-sm text-muted-foreground">
            {isSignup ? "Have an account?" : "New here?"}{" "}
            <button
              onClick={() => { setIsSignup(!isSignup); setStep("email"); setCode(""); }}
              className="text-primary hover:underline"
            >
              {isSignup ? "Sign in" : "Create one"}
            </button>
          </div>

          <div className="mt-5 flex items-center justify-center gap-2 text-[11px] text-muted-foreground">
            <Link to="/terms" className="hover:text-foreground">Terms</Link>
            <span>·</span>
            <Link to="/privacy" className="hover:text-foreground">Privacy</Link>
            {isSignup && (
              <>
                <span>·</span>
                <Link to="/disclaimer" className="hover:text-foreground">Earnings</Link>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
