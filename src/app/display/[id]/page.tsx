import DisplayScreen from "@/components/DisplayScreen";

export default async function DisplayPage({ params }: PageProps<"/display/[id]">) {
  const { id } = await params;
  return <DisplayScreen sessionId={id} />;
}
