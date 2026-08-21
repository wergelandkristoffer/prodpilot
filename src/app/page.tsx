import AuthGate from "@/components/AuthGate";

export default async function Home({ searchParams }: PageProps<"/">) {
  const params = await searchParams;
  const s = typeof params.s === "string" ? params.s : undefined;
  return <AuthGate initialSessionId={s} />;
}
