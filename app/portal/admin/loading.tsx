import { ServerPageLoader } from "@/components/ui/ServerPageLoader";

// Streamed instantly while the admin page's client bundle downloads + hydrates.
export default function AdminLoading() {
  return <ServerPageLoader />;
}
