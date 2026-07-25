import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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

function AuthPage() {
  const { mode, ref } = Route.useSearch();
  const navigate = useNavigate();
  const [isSignup, setIsSignup] = useState(mode === "signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [refCode, setRefCode] = useState(ref ?? "");
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => { setIsSignup(mode === "signup"); }, [mode]);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard" });
    });
  }, [navigate]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!expanded) { setExpanded(true); return; }
    setLoading(true);
    try {
      if (isSignup) {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: {
            emailRedirectTo: window.location.origin,
            data: refCode ? { ref: refCode.trim().toUpperCase() } : {},
          },
        });
        if (error) throw error;
        toast.success("Account created!");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      navigate({ to: "/dashboard" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Auth failed");
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
            {isSignup ? "Create your PayTrony account" : "Welcome to PayTrony"}
          </h1>

          <form onSubmit={onSubmit} className="mt-6 space-y-3">
            <div className="flex items-stretch gap-2">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email address"
                className="flex-1 rounded-lg border border-input bg-input/60 px-3.5 py-2.5 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
              />
              {!expanded && (
                <button
                  type="submit"
                  disabled={!email}
                  className="rounded-lg bg-muted px-4 text-sm font-medium text-foreground/80 transition hover:bg-muted/70 disabled:opacity-50"
                >
                  Continue
                </button>
              )}
            </div>

            {expanded && (
              <>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  autoFocus
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
                  disabled={loading}
                  className="glow w-full rounded-lg bg-primary py-2.5 font-medium text-primary-foreground disabled:opacity-50"
                >
                  {loading ? "…" : isSignup ? "Create account" : "Sign in"}
                </button>
              </>
            )}
          </form>

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

          {!isSignup && (
            <div className="mt-4 text-center text-xs">
              <Link to="/forgot-password" className="text-muted-foreground hover:text-foreground">Forgot password?</Link>
            </div>
          )}

          <div className="mt-4 text-center text-sm text-muted-foreground">
            {isSignup ? "Have an account?" : "New here?"}{" "}
            <button onClick={() => setIsSignup(!isSignup)} className="text-primary hover:underline">
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
