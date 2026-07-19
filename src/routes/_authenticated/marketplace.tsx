import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/marketplace")({
  head: () => ({
    meta: [
      { title: "Marketplace — PayTrony" },
      { name: "description", content: "Buy and sell PayTrony NFTs on the peer-to-peer marketplace." },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Marketplace — PayTrony" },
      { property: "og:description", content: "Coming soon: sell your PayTrony NFTs on the peer-to-peer marketplace." },
    ],
  }),
  component: MarketplacePage,
});

function MarketplacePage() {
  return (
    <div className="mx-auto max-w-3xl">
      <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-b from-background to-muted/30 p-10">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            background:
              "radial-gradient(600px 200px at 20% 0%, hsl(var(--primary)/0.25), transparent 60%), radial-gradient(500px 200px at 90% 100%, hsl(var(--accent)/0.2), transparent 60%)",
          }}
        />
        <div className="relative">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-background/60 px-3 py-1 text-[10px] font-mono uppercase tracking-widest text-muted-foreground backdrop-blur">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-70" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
            </span>
            Coming soon
          </div>

          <h1 className="mt-5 text-4xl font-semibold tracking-tight md:text-5xl">
            NFT Marketplace
          </h1>
          <p className="mt-4 max-w-xl text-muted-foreground">
            List, discover, and trade PayTrony NFTs directly with other holders. We're
            building a secure peer-to-peer marketplace where you set your own price and
            keep the majority of every sale.
          </p>

          <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
            {[
              { title: "List your NFTs", desc: "Set a price and go live in seconds." },
              { title: "Instant settlement", desc: "Funds credited to your wallet on sale." },
              { title: "Low fees", desc: "Transparent flat platform fee — no surprises." },
            ].map((f) => (
              <div
                key={f.title}
                className="rounded-xl border border-border bg-background/40 p-4 backdrop-blur"
              >
                <div className="text-sm font-medium">{f.title}</div>
                <div className="mt-1 text-xs text-muted-foreground">{f.desc}</div>
              </div>
            ))}
          </div>

          <div className="mt-8 flex items-center gap-3">
            <button
              disabled
              className="cursor-not-allowed rounded-md border border-border bg-primary/20 px-4 py-2 text-sm font-medium text-primary opacity-70"
            >
              Notify me
            </button>
            <span className="text-xs text-muted-foreground">
              We'll announce launch inside your Notifications.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
