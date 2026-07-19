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

  useEffect(() => {
    supabase.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin")
      .then(({ data }) => setIsAdmin(!!(data && data.length)));
  }, [user.id]);

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/", replace: true });
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/dashboard" className="font-mono text-lg font-semibold">
            <span className="text-primary">◆</span> PayTrony
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link to="/dashboard" className="text-muted-foreground hover:text-foreground" activeProps={{ className: "text-foreground" }}>Dashboard</Link>
            <Link to="/packages" className="text-muted-foreground hover:text-foreground" activeProps={{ className: "text-foreground" }}>Packages</Link>
            <Link to="/ledger" className="text-muted-foreground hover:text-foreground" activeProps={{ className: "text-foreground" }}>Ledger</Link>
            <Link to="/withdraw" className="text-muted-foreground hover:text-foreground" activeProps={{ className: "text-foreground" }}>Withdraw</Link>
            {isAdmin && <Link to="/admin" className="text-accent hover:text-accent" activeProps={{ className: "text-accent" }}>Admin</Link>}
            <button onClick={signOut} className="rounded-md border border-border px-3 py-1.5 text-xs">Sign out</button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8"><Outlet /></main>
    </div>
  );
}
