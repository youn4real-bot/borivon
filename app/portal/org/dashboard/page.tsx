"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { PageLoader } from "@/components/ui/states";

/**
 * RETIRED. Organization people are now org-scoped sub-admins and use the full
 * Borivon admin dashboard (/portal/admin), restricted to their organization's
 * candidates. This route just forwards anyone with an old bookmark/link.
 */
export default function RetiredOrgDashboard() {
  const router = useRouter();
  useEffect(() => { router.replace("/portal/admin"); }, [router]);
  return <PageLoader />;
}
