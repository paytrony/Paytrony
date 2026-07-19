import { createFileRoute, Outlet, redirect, Link, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth", search: { mode: "signin" } });
    return { user: data.user };
  },
  component: AuthedLayout,
});

function AuthedLayout() {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const [isAdmin, setIsAdmin] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    supabase.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin")
      .then(({ data }) => setIsAdmin(!!(data && data.length)));
  }, [user.id]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuOpen]);

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/", replace: true });
  }

  const linkClass = "block px-4 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground";

  return (
    <div className="min-h-screen">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/dashboard" className="font-mono text-lg font-semibold">
            <span className="text-primary">◆</span> PayTrony
          </Link>
          <nav className="flex items-center gap-3 text-sm">
            <div className="relative" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => setMenuOpen((v) => !v)}
                aria-label="Menu"
                aria-expanded={menuOpen}
                className="flex h-9 w-9 items-center justify-center rounded-md border border-border text-foreground hover:bg-muted"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.75"/><circle cx="12" cy="12" r="1.75"/><circle cx="12" cy="19" r="1.75"/></svg>
              </button>
              {menuOpen && (
                <div className="absolute right-0 z-50 mt-2 w-44 overflow-hidden rounded-md border border-border bg-background shadow-lg">
                  <Link to="/dashboard" className={linkClass} activeProps={{ className: linkClass + " text-foreground" }} onClick={() => setMenuOpen(false)}>Dashboard</Link>
                  <Link to="/packages" className={linkClass} activeProps={{ className: linkClass + " text-foreground" }} onClick={() => setMenuOpen(false)}>Packages</Link>
                  <Link to="/ledger" className={linkClass} activeProps={{ className: linkClass + " text-foreground" }} onClick={() => setMenuOpen(false)}>Ledger</Link>
                  <Link to="/withdraw" className={linkClass} activeProps={{ className: linkClass + " text-foreground" }} onClick={() => setMenuOpen(false)}>Withdraw</Link>
                  {isAdmin && <Link to="/admin" className={linkClass + " text-accent"} onClick={() => setMenuOpen(false)}>Admin</Link>}
                </div>
              )}
            </div>
            <button onClick={signOut} className="rounded-md border border-border px-3 py-1.5 text-xs">Sign out</button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8"><Outlet /></main>
    </div>
  );
}
