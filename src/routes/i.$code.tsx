import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/i/$code")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "You're invited to PayTrony" },
      { name: "description", content: "Join PayTrony with an invite link and start earning referral rewards." },
      { property: "og:title", content: "You're invited to PayTrony" },
      { property: "og:description", content: "Join PayTrony with an invite link and start earning referral rewards." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: InviteRedirect,
});

function InviteRedirect() {
  const { code } = Route.useParams();
  return <Navigate to="/auth" search={{ mode: "signup", ref: code } as never} replace />;
}
