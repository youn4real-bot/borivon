import { Suspense } from "react";
import { Workspace } from "../Workspace";

/** The example workspace: real screens, made-up data, nothing saved (components/fx/demo.ts). */
export default function Page() {
  return <Suspense fallback={null}><Workspace demo /></Suspense>;
}
