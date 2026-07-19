import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { deleteMyAccount } from "@/lib/wallet.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Account settings — PayTrony" }] }),
  component: Settings,
});

type Profile = { display_name: string | null; kyc_status: string; email: string };

function Settings() {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const delFn = useServerFn(deleteMyAccount);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [emailVerified, setEmailVerified] = useState<boolean>(false);
  const [displayName, setDisplayName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  async function load() {
    const { data } = await supabase.from("profiles").select("display_name,kyc_status,email").eq("id", user.id).maybeSingle();
    setProfile(data as Profile);
    setDisplayName((data as any)?.display_name ?? "");
    const { data: u } = await supabase.auth.getUser();
    setEmailVerified(!!u.user?.email_confirmed_at);
  }
  useEffect(() => { load(); }, [user.id]);

  async function saveDisplayName() {
    setBusy(true);
    try {
      const { error } = await supabase.from("profiles").update({ display_name: displayName || null }).eq("id", user.id);
      if (error) throw error;
      toast.success("Display name saved");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  }

  async function changePassword() {
    if (newPassword.length < 6) return toast.error("At least 6 characters");
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      toast.success("Password changed");
      setNewPassword("");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  }

  async function changeEmail() {
    if (!newEmail) return;
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ email: newEmail });
      if (error) throw error;
      toast.success("Confirmation sent to both emails");
      setNewEmail("");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  }

  async function resendVerification() {
    setBusy(true);
    try {
      const { error } = await supabase.auth.resend({ type: "signup", email: profile?.email ?? user.email ?? "" });
      if (error) throw error;
      toast.success("Verification email sent");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  }

  async function submitKyc() {
    setBusy(true);
    try {
      const { error } = await supabase.rpc("submit_kyc", { _user_id: user.id });
      if (error) throw error;
      toast.success("KYC submitted for review");
      await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  }

  async function doDelete() {
    if (confirmText !== "DELETE") return;
    setBusy(true);
    try {
      await delFn();
      await supabase.auth.signOut();
      toast.success("Account deleted");
      navigate({ to: "/" });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); setBusy(false); }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Account settings</h1>
        <p className="text-muted-foreground">Profile, security, verification, and account deletion.</p>
      </div>

      <Section title="Profile">
        <Row label="Email">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm">{profile?.email}</span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-mono uppercase ${emailVerified ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}>
              {emailVerified ? "verified" : "unverified"}
            </span>
            {!emailVerified && <button onClick={resendVerification} disabled={busy} className="text-xs text-primary hover:underline">Resend</button>}
          </div>
        </Row>
        <Row label="Display name">
          <div className="flex gap-2">
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={40}
              className="flex-1 rounded-md border border-input bg-input px-3 py-2 text-sm" />
            <button onClick={saveDisplayName} disabled={busy} className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">Save</button>
          </div>
        </Row>
      </Section>

      <Section title="Security">
        <Row label="Change password">
          <div className="flex gap-2">
            <input type="password" minLength={6} value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
              placeholder="New password" className="flex-1 rounded-md border border-input bg-input px-3 py-2 text-sm" />
            <button onClick={changePassword} disabled={busy || !newPassword} className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">Update</button>
          </div>
        </Row>
        <Row label="Change email">
          <div className="flex gap-2">
            <input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)}
              placeholder="new@example.com" className="flex-1 rounded-md border border-input bg-input px-3 py-2 text-sm" />
            <button onClick={changeEmail} disabled={busy || !newEmail} className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">Update</button>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">You'll get a confirmation link at both the old and new address.</div>
        </Row>
      </Section>

      <Section title="Identity verification (KYC)">
        <div className="rounded-md border border-border bg-muted/30 p-4 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Status:</span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-mono uppercase ${
              profile?.kyc_status === "approved" ? "bg-primary/20 text-primary" :
              profile?.kyc_status === "pending" ? "bg-accent/20 text-accent" :
              profile?.kyc_status === "rejected" ? "bg-destructive/20 text-destructive" :
              "bg-muted text-muted-foreground"
            }`}>{profile?.kyc_status ?? "none"}</span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            KYC is required to withdraw more than the base threshold. In this demo, submitting KYC flags your account for admin review (no documents collected).
          </p>
          {(profile?.kyc_status === "none" || profile?.kyc_status === "rejected") && (
            <button onClick={submitKyc} disabled={busy} className="mt-3 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">
              Submit for review
            </button>
          )}
        </div>
      </Section>

      <Section title="Danger zone">
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4">
          <h3 className="text-sm font-semibold text-destructive">Delete account</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Permanently deletes your account, profile, purchases, wallet history, and NFTs. This can't be undone.
          </p>
          {!confirmDelete ? (
            <button onClick={() => setConfirmDelete(true)} className="mt-3 rounded-md border border-destructive px-4 py-2 text-sm text-destructive">
              Delete my account
            </button>
          ) : (
            <div className="mt-3 space-y-2">
              <div className="text-xs">Type <span className="font-mono font-bold text-destructive">DELETE</span> to confirm:</div>
              <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)}
                className="w-full rounded-md border border-input bg-input px-3 py-2 text-sm" />
              <div className="flex gap-2">
                <button onClick={() => { setConfirmDelete(false); setConfirmText(""); }} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
                <button onClick={doDelete} disabled={busy || confirmText !== "DELETE"}
                  className="rounded-md bg-destructive px-4 py-2 text-sm text-destructive-foreground disabled:opacity-50">
                  Permanently delete
                </button>
              </div>
            </div>
          )}
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-6">
      <h2 className="mb-4 text-lg font-semibold">{title}</h2>
      <div className="space-y-4">{children}</div>
    </section>
  );
}
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs font-mono uppercase text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}
