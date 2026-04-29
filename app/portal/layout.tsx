// Portal layout — providers + navbar + bug button now live in the root
// layout (`app/layout.tsx`) via <GlobalChrome>, so this is a pass-through.
export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
