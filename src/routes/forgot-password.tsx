import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({ meta: [{ title: "Forgot password — PayTrony" }] }),
  component: ForgotPassword,
});

function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      setSent(true);
      toast.success("Check your email for the reset link");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally { setLoading(false); }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md">
        <Link to="/" className="mb-6 block text-center font-mono text-sm text-muted-foreground">← PayTrony</Link>
        <div className="rounded-2xl border border-border bg-card p-8">
          <h1 className="text-2xl font-bold">Reset your password</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {sent ? "If an account exists for that email, a reset link is on its way." : "We'll email you a link to set a new password."}
          </p>
          {!sent && (
            <form onSubmit={onSubmit} className="mt-6 space-y-4">
              <div>
                <label className="text-sm font-medium">Email</label>
                <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 w-full rounded-md border border-input bg-input px-3 py-2 text-sm" />
              </div>
              <button type="submit" disabled={loading}
                className="w-full rounded-md bg-primary py-2.5 font-medium text-primary-foreground disabled:opacity-50">
                {loading ? "…" : "Send reset link"}
              </button>
            </form>
          )}
          <div className="mt-4 text-center text-sm">
            <Link to="/auth" search={{ mode: "signin" }} className="text-muted-foreground hover:text-foreground">Back to sign in</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
