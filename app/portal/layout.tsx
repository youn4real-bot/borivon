import type { Metadata } from "next";
import { preconnect, preload } from "react-dom";
import { bvLoaderHtml } from "@/components/ui/BvLoader";

/**
 * Portal layout — providers + navbar + bug button live in the root layout
 * (app/layout.tsx) via <GlobalChrome>, so this is a pass-through.
 *
 * We do set a title template here so every portal page gets "… | Borivon Portal"
 * instead of the root "… | Borivon".
 */
export const metadata: Metadata = {
  title: {
    template: "%s | Borivon Portal",
    default: "Borivon Portal",
  },
  // The portal is a logged-in application, not content. It inherited the root
  // layout's `index, follow`, so the login screen and every dashboard URL under
  // it were being offered to Google — nothing there is useful in a search
  // result, and a candidate landing on a bare login page from Google is a worse
  // first touch than the homepage. Overrides the root for this whole subtree.
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false },
  },
};

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  // Open the connection to the login service early (Supabase is a listed processor).
  // No preconnect to Google: /portal is also the public login page, and a preconnect alone hands
  // the visitor's IP to Google before anyone signed in (2026-11-10). Profile photos still load
  // normally after a Google sign-in.
  const supa = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (supa) preconnect(supa, { crossOrigin: "anonymous" });
  // in <head>: the browser asks at once, before the CSS and scripts (the inline ping below then reuses it)
  preload("/api/health", { as: "fetch", crossOrigin: "anonymous" });
  // Wake the server while the page's JavaScript is still downloading (founder 2026-11-12: "loading is slow").
  // The portal page itself now comes straight from the edge; only its data calls need the worker, and a cold
  // worker costs 1-3 s. This tiny ping starts that cold start at once, so it overlaps the download instead of
  // following it. Own origin only, no data, nothing stored.
  return (
    <>
      {/* Boot cover (founder 2026-11-14: "show a blank page with the loading animation right from the beginning",
          no old logo flashing, no top-bar icons popping in one by one). The page is invisible from the very
          first paint (this style is hoisted into <head>); the script below puts the animated logo on top and
          reveals everything AT ONCE when the fonts are in, the page's own loader is gone and the DOM has been
          quiet for a moment. Fail-safes: no JavaScript -> <noscript> shows the page; script error or a page that
          never settles -> the CSS animation makes it visible after 9 s anyway. */}
      <style href="bv-boot" precedence="bv-boot">{BOOT_CSS}</style>
      <noscript><style>{"body{visibility:visible!important;animation:none!important}"}</style></noscript>
      <script dangerouslySetInnerHTML={{ __html: "try{fetch('/api/health',{cache:'no-store',keepalive:true}).catch(function(){})}catch(e){}" }} />
      <script dangerouslySetInnerHTML={{ __html: BOOT_JS }} />
      {children}
    </>
  );
}

const BOOT_CSS =
  "body{visibility:hidden;animation:bvBootSafe 0s 9s forwards}" +
  "@keyframes bvBootSafe{to{visibility:visible}}" +
  "#bv-boot{position:fixed;inset:0;z-index:2147483000;visibility:visible;display:flex;align-items:center;justify-content:center;" +
  "background:var(--bg,#f4f1ea);transition:opacity .24s ease}" +
  "#bv-boot.bv-out{opacity:0;pointer-events:none}";

// Runs while the HTML is still being parsed. Ready = fonts loaded + every script/image loaded (readyState
// complete, so the page has hydrated) + no page loader (data-bv-loader) left outside the cover + no DOM change
// for 200 ms (the top bar has settled). Hard stop after 8 s so nobody is ever stuck.
const BOOT_JS = `(function(){try{
var d=document,t0=Date.now(),last=t0,fonts=!d.fonts,o=d.createElement("div");
o.id="bv-boot";o.setAttribute("aria-hidden","true");o.innerHTML=${JSON.stringify(bvLoaderHtml())};
(d.body||d.documentElement).appendChild(o);
if(d.fonts&&d.fonts.ready)d.fonts.ready.then(function(){fonts=true},function(){fonts=true});
var mo=new MutationObserver(function(){last=Date.now()});
function busy(){var l=d.querySelectorAll("[data-bv-loader]");for(var i=0;i<l.length;i++){if(!o.contains(l[i]))return true}return false}
function show(){try{mo.disconnect()}catch(e){}var s=d.createElement("style");s.textContent="body{visibility:visible!important;animation:none!important}";d.head.appendChild(s);
setTimeout(function(){o.className="bv-out";setTimeout(function(){if(o.parentNode)o.parentNode.removeChild(o)},300)},16)}
function tick(){var n=Date.now();if(n-t0>8000)return show();if(fonts&&d.readyState==="complete"&&!busy()&&n-last>200&&n-t0>300)return show();setTimeout(tick,50)}
function go(){try{mo.observe(d.body,{childList:true,subtree:true,characterData:true})}catch(e){}tick()}
if(d.readyState==="loading")d.addEventListener("DOMContentLoaded",go);else go();
}catch(e){var s=document.createElement("style");s.textContent="body{visibility:visible!important}";document.head.appendChild(s)}})();`;
