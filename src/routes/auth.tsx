import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const search = z.object({
  mode: z.enum(["signin", "signup"]).optional().default("signin"),
  ref: z.string().optional(),
});

export const Route = createFileRoute("/auth")({
  validateSearch: search,
  component: AuthPage,
});

function AuthPage() {
  const { mode, ref } = Route.useSearch();
  const navigate = useNavigate();
  const [isSignup, setIsSignup] = useState(mode === "signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [refCode, setRefCode] = useState(ref ?? "");
  const [loading, setLoading] = useState(false);

  useEffect(() => { setIsSignup(mode === "signup"); }, [mode]);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard" });
    });
  }, [navigate]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
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
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md">
        <Link to="/" className="mb-6 block text-center font-mono text-sm text-muted-foreground">← ReferNFT</Link>
        <div className="rounded-2xl border border-border bg-card p-8">
          <h1 className="text-2xl font-bold">{isSignup ? "Create account" : "Welcome back"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isSignup ? "Start earning referral rewards." : "Sign in to your wallet."}
          </p>

          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <div>
              <label className="text-sm font-medium">Email</label>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-input px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div>
              <label className="text-sm font-medium">Password</label>
              <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-input px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
            </div>
            {isSignup && (
              <div>
                <label className="text-sm font-medium">Referral code <span className="text-muted-foreground">(optional)</span></label>
                <input value={refCode} onChange={(e) => setRefCode(e.target.value)} placeholder="e.g. A1B2C3D4"
                  className="mt-1 w-full rounded-md border border-input bg-input px-3 py-2 font-mono text-sm uppercase outline-none focus:ring-2 focus:ring-ring" />
              </div>
            )}
            <button type="submit" disabled={loading}
              className="glow w-full rounded-md bg-primary py-2.5 font-medium text-primary-foreground disabled:opacity-50">
              {loading ? "…" : isSignup ? "Create account" : "Sign in"}
            </button>
          </form>

          <div className="mt-6 text-center text-sm text-muted-foreground">
            {isSignup ? "Have an account?" : "New here?"}{" "}
            <button onClick={() => setIsSignup(!isSignup)} className="text-primary hover:underline">
              {isSignup ? "Sign in" : "Create one"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
