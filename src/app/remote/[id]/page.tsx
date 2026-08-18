import RemoteControl from "@/components/RemoteControl";

export default async function RemotePage({ params }: PageProps<"/remote/[id]">) {
  const { id } = await params;
  return <RemoteControl sessionId={id} />;
}
