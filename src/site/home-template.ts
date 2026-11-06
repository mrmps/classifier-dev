// Generated from the design prototype by tools/port.py. Edit the prototype, then re-run the port.
// The page is served as-is by src/site/home.ts; its scripts and styles live in public/site/.
export const HOME_TEMPLATE = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>classifier.dev, zero-shot classification over plain HTTP</title>
<meta name="description" content="Zero-shot classification over plain HTTP. Free for agents, with no key or account.">
<link rel="preload" href="/site/fonts/biz-udpmincho-400.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/site/fonts/funnel-sans-400.woff2" as="font" type="font/woff2" crossorigin>

<link rel="icon" href="/site/public/brand/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/site/public/brand/apple-touch-icon.png">
<link rel="manifest" href="/site/site.webmanifest">
<meta property="og:type" content="website">
<meta property="og:title" content="classifier.dev">
<meta property="og:description" content="Zero-shot classification over plain HTTP. Free for agents, with no key or account.">
<meta property="og:image" content="https://classifier.dev/site/public/brand/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="https://classifier.dev/site/public/brand/og.png">
<link rel="alternate" type="text/markdown" href="/index.md" title="This page as Markdown">
<link rel="stylesheet" href="/site/styles.css">
<link rel="stylesheet" href="/site/signal.css">
<script>(function(){var s=new URLSearchParams(location.search).get('scheme');if(s!=='light'&&s!=='dark'){try{s=localStorage.getItem('signal:scheme')}catch(e){}}if(s!=='light'&&s!=='dark')s=matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';var r=document.documentElement,q=new URLSearchParams(location.search);r.dataset.scheme=s;r.dataset.accent=q.get('accent')||'blue';if(q.get('fields')==='0'){r.dataset.fields='off'}if(innerWidth<768&&!matchMedia('(prefers-reduced-motion: reduce)').matches&&location.hash===''&&scrollY===0){var v=null;try{v=sessionStorage.getItem('signal:intro');sessionStorage.setItem('signal:intro','1')}catch(e){}void v}})();document.documentElement.classList.add('js');if(!matchMedia('(prefers-reduced-motion: reduce)').matches)document.documentElement.classList.add('is-loading');setTimeout(function(){document.documentElement.classList.remove('is-loading')},600)</script>
</head>
<body data-agent-prompt="Set up the classifier.dev skill: run &#96;npx skills add https://classifier.dev&#96;, then read https://classifier.dev/skill.md and follow it all the way through.">
<!--icons--><svg class="sprite" aria-hidden="true" style="position:absolute;width:0;height:0;overflow:hidden"><symbol id="i-copy" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></symbol><symbol id="i-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></symbol><symbol id="i-book-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v16" /><path d="M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z" /></symbol><symbol id="i-arrow-right" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></symbol><symbol id="i-arrow-up-right" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M7 7h10v10" /><path d="M7 17 17 7" /></symbol><symbol id="i-terminal" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19h8" /><path d="m4 17 6-6-6-6" /></symbol><symbol id="i-braces" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1" /><path d="M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1" /></symbol><symbol id="i-plug" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22v-5" /><path d="M15 8V2" /><path d="M17 8a1 1 0 0 1 1 1v4a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1z" /><path d="M9 8V2" /></symbol><symbol id="i-sparkles" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z" /><path d="M20 2v4" /><path d="M22 4h-4" /><circle cx="4" cy="20" r="2" /></symbol><symbol id="i-code" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m16 18 6-6-6-6" /><path d="m8 6-6 6 6 6" /></symbol><symbol id="i-gauge" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m12 14 4-4" /><path d="M3.34 19a10 10 0 1 1 17.32 0" /></symbol><symbol id="i-coins" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M13.744 17.736a6 6 0 1 1-7.48-7.48" /><path d="M15 6h1v4" /><path d="m6.134 14.768.866-.5 2 3.464" /><circle cx="16" cy="8" r="6" /></symbol><symbol id="i-user" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></symbol><symbol id="i-globe" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" /><path d="M2 12h20" /></symbol><symbol id="i-zap" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z" /></symbol><symbol id="i-wallet" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" /><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" /></symbol><symbol id="i-users" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><path d="M16 3.128a4 4 0 0 1 0 7.744" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><circle cx="9" cy="7" r="4" /></symbol><symbol id="i-chart-column" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v16a2 2 0 0 0 2 2h16" /><path d="M18 17V9" /><path d="M13 17V5" /><path d="M8 17v-3" /></symbol><symbol id="i-infinity" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M6 16c5 0 7-8 12-8a4 4 0 0 1 0 8c-5 0-7-8-12-8a4 4 0 1 0 0 8" /></symbol><symbol id="i-server" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="8" x="2" y="2" rx="2" ry="2" /><rect width="20" height="8" x="2" y="14" rx="2" ry="2" /><line x1="6" x2="6.01" y1="6" y2="6" /><line x1="6" x2="6.01" y1="18" y2="18" /></symbol><symbol id="i-box" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" /><path d="m3.3 7 8.7 5 8.7-5" /><path d="M12 22V12" /></symbol><symbol id="i-lock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></symbol><symbol id="i-target" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></symbol><symbol id="i-search" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m21 21-4.34-4.34" /><circle cx="11" cy="11" r="8" /></symbol><symbol id="i-ticket" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" /><path d="M13 5v2" /><path d="M13 17v2" /><path d="M13 11v2" /></symbol><symbol id="i-scroll-text" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M15 12h-5" /><path d="M15 8h-5" /><path d="M19 17V5a2 2 0 0 0-2-2H4" /><path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3" /></symbol><symbol id="i-filter" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z" /></symbol><symbol id="i-shield-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" /><path d="m9 12 2 2 4-4" /></symbol><symbol id="i-layers" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z" /><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12" /><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17" /></symbol><symbol id="i-message-square" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" /></symbol><symbol id="i-package" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z" /><path d="M12 22V12" /><polyline points="3.29 7 12 12 20.71 7" /><path d="m7.5 4.27 9 5.15" /></symbol><symbol id="i-file-json" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" /><path d="M14 2v5a1 1 0 0 0 1 1h5" /><path d="M10 12a1 1 0 0 0-1 1v1a1 1 0 0 1-1 1 1 1 0 0 1 1 1v1a1 1 0 0 0 1 1" /><path d="M14 18a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1 1 1 0 0 1-1-1v-1a1 1 0 0 0-1-1" /></symbol><symbol id="i-tag" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" /><circle cx="7.5" cy="7.5" r=".5" fill="currentColor" /></symbol><symbol id="i-pencil" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" /><path d="m15 5 4 4" /></symbol><symbol id="i-chevron-down" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6" /></symbol><symbol id="i-maximize-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6" /><path d="m21 3-7 7" /><path d="m3 21 7-7" /><path d="M9 21H3v-6" /></symbol><symbol id="i-mail" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7" /><rect x="2" y="4" width="20" height="16" rx="2" /></symbol><symbol id="i-inbox" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></symbol><symbol id="i-x" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></symbol><symbol id="si-python" viewBox="0 0 24 24"><path fill="#3776AB" d="M14.25.18l.9.2.73.26.59.3.45.32.34.34.25.34.16.33.1.3.04.26.02.2-.01.13V8.5l-.05.63-.13.55-.21.46-.26.38-.3.31-.33.25-.35.19-.35.14-.33.1-.3.07-.26.04-.21.02H8.77l-.69.05-.59.14-.5.22-.41.27-.33.32-.27.35-.2.36-.15.37-.1.35-.07.32-.04.27-.02.21v3.06H3.17l-.21-.03-.28-.07-.32-.12-.35-.18-.36-.26-.36-.36-.35-.46-.32-.59-.28-.73-.21-.88-.14-1.05-.05-1.23.06-1.22.16-1.04.24-.87.32-.71.36-.57.4-.44.42-.33.42-.24.4-.16.36-.1.32-.05.24-.01h.16l.06.01h8.16v-.83H6.18l-.01-2.75-.02-.37.05-.34.11-.31.17-.28.25-.26.31-.23.38-.2.44-.18.51-.15.58-.12.64-.1.71-.06.77-.04.84-.02 1.27.05zm-6.3 1.98l-.23.33-.08.41.08.41.23.34.33.22.41.09.41-.09.33-.22.23-.34.08-.41-.08-.41-.23-.33-.33-.22-.41-.09-.41.09zm13.09 3.95l.28.06.32.12.35.18.36.27.36.35.35.47.32.59.28.73.21.88.14 1.04.05 1.23-.06 1.23-.16 1.04-.24.86-.32.71-.36.57-.4.45-.42.33-.42.24-.4.16-.36.09-.32.05-.24.02-.16-.01h-8.22v.82h5.84l.01 2.76.02.36-.05.34-.11.31-.17.29-.25.25-.31.24-.38.2-.44.17-.51.15-.58.13-.64.09-.71.07-.77.04-.84.01-1.27-.04-1.07-.14-.9-.2-.73-.25-.59-.3-.45-.33-.34-.34-.25-.34-.16-.33-.1-.3-.04-.25-.02-.2.01-.13v-5.34l.05-.64.13-.54.21-.46.26-.38.3-.32.33-.24.35-.2.35-.14.33-.1.3-.06.26-.04.21-.02.13-.01h5.84l.69-.05.59-.14.5-.21.41-.28.33-.32.27-.35.2-.36.15-.36.1-.35.07-.32.04-.28.02-.21V6.07h2.09l.14.01zm-6.47 14.25l-.23.33-.08.41.08.41.23.33.33.23.41.08.41-.08.33-.23.23-.33.08-.41-.08-.41-.23-.33-.33-.23-.41-.08-.41.08z"/></symbol><symbol id="si-javascript" viewBox="0 0 24 24"><path fill="#F7DF1E" d="M0 0h24v24H0V0zm22.034 18.276c-.175-1.095-.888-2.015-3.003-2.873-.736-.345-1.554-.585-1.797-1.14-.091-.33-.105-.51-.046-.705.15-.646.915-.84 1.515-.66.39.12.75.42.976.9 1.034-.676 1.034-.676 1.755-1.125-.27-.42-.404-.601-.586-.78-.63-.705-1.469-1.065-2.834-1.034l-.705.089c-.676.165-1.32.525-1.71 1.005-1.14 1.291-.811 3.541.569 4.471 1.365 1.02 3.361 1.244 3.616 2.205.24 1.17-.87 1.545-1.966 1.41-.811-.18-1.26-.586-1.755-1.336l-1.83 1.051c.21.48.45.689.81 1.109 1.74 1.756 6.09 1.666 6.871-1.004.029-.09.24-.705.074-1.65l.046.067zm-8.983-7.245h-2.248c0 1.938-.009 3.864-.009 5.805 0 1.232.063 2.363-.138 2.711-.33.689-1.18.601-1.566.48-.396-.196-.597-.466-.83-.855-.063-.105-.11-.196-.127-.196l-1.825 1.125c.305.63.75 1.172 1.324 1.517.855.51 2.004.675 3.207.405.783-.226 1.458-.691 1.811-1.411.51-.93.402-2.07.397-3.346.012-2.054 0-4.109 0-6.179l.004-.056z"/></symbol><symbol id="si-googlegemini" viewBox="0 0 24 24"><path fill="#8E75B2" d="M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81"/></symbol></svg><!--/icons-->

<a class="skip" href="#main">Skip to content</a>
<div class="signal-art" aria-hidden="true"><canvas id="art"></canvas></div>

<header class="nav" id="nav">
  <div class="rail nav__rail">
    <a class="brand" href="#top" aria-label="classifier.dev home"><svg class="lk" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg" viewBox="0 -874.7 7380.6 1089.8" fill="currentColor"><g transform="translate(-272.71 -957.09) scale(13.394)"><path fill-rule="evenodd" d="M32.21 20.36L32.20 20.36L32.19 20.36L32.18 20.36L32.18 20.37L32.18 20.38L32.28 21.27L32.30 22.19L32.29 23.14L32.26 24.11L32.22 25.08L32.17 26.05L32.12 27.03L32.06 28.01L32.01 28.98L31.96 29.96L31.93 30.92L31.91 31.88L31.90 32.83L31.92 33.76L31.96 34.68L31.96 34.69L32.02 35.59L32.12 36.48L32.25 37.35L32.41 38.20L32.61 39.02L32.85 39.82L32.86 39.82L33.14 40.59L33.14 40.60L33.48 41.34L33.86 42.06L34.30 42.74L34.79 43.39L34.80 43.39L35.35 44.01L35.95 44.59L35.96 44.59L36.63 45.13L37.36 45.63L37.36 45.64L38.16 46.10L39.03 46.53L39.96 46.91L40.97 47.25L42.05 47.55L43.20 47.80L43.74 47.89L43.74 49.01L42.97 48.75L42.96 48.75L41.83 48.43L40.74 48.19L39.69 48.02L38.68 47.92L37.72 47.89L36.79 47.92L35.91 48.02L35.90 48.02L35.06 48.19L34.25 48.41L33.47 48.70L32.73 49.04L32.02 49.44L31.35 49.89L30.70 50.39L30.08 50.94L29.49 51.53L28.93 52.16L28.39 52.83L28.39 52.84L27.87 53.54L27.86 53.54L27.36 54.28L26.88 55.05L26.41 55.85L25.96 56.67L25.52 57.51L25.09 58.36L24.66 59.23L24.25 60.11L23.84 61.00L23.42 61.89L23.01 62.77L22.60 63.66L22.18 64.54L21.76 65.40L21.32 66.24L20.86 67.05L20.36 67.79L20.36 67.80L20.36 67.81L20.36 67.82L20.37 67.82L20.38 67.82L21.27 67.72L22.19 67.70L23.14 67.71L24.11 67.74L25.08 67.78L26.05 67.83L27.03 67.88L28.01 67.94L28.98 67.99L29.96 68.04L30.92 68.07L31.88 68.09L32.83 68.10L33.76 68.08L34.68 68.04L34.69 68.04L35.59 67.98L36.48 67.88L37.35 67.75L38.20 67.59L39.02 67.39L39.82 67.15L39.82 67.14L40.59 66.86L40.60 66.86L41.34 66.52L42.06 66.14L42.74 65.70L43.39 65.21L43.39 65.20L43.76 64.87L43.77 64.87L43.77 64.86L43.77 62.51L49.99 62.51L50.01 62.51L56.24 62.51L56.24 68.74L49.99 68.74L49.99 75.01L56.24 75.01L56.26 75.01L62.49 75.01L62.49 81.26L68.76 81.26L68.76 75.01L68.76 74.99L68.76 68.74L62.51 68.74L62.51 62.51L62.51 62.49L62.51 56.26L62.51 56.24L62.51 50.01L68.76 50.01L68.76 43.76L75.01 43.76L75.01 37.51L75.01 37.49L75.01 31.24L68.76 31.24L68.74 31.24L62.51 31.24L62.49 31.24L56.24 31.24L56.24 37.49L50.01 37.49L50.01 31.26L50.01 31.24L50.01 24.99L43.74 24.99C40.2 23.9 36.2 21.6 32.21 20.36ZM56.26 49.99L56.24 49.99L50.01 49.99L50.01 43.76L56.26 43.76L56.26 37.51L62.49 37.51L62.51 37.51L68.74 37.51L68.74 43.74L62.49 43.74L62.49 49.99Z"/><path class="pol" style="--dx:0.0px;--dy:-12.5px;--i:0" d="M68.76 18.74L62.49 18.74L62.49 25.01L68.76 25.01Z"/><path class="pol" style="--dx:6.25px;--dy:-12.5px;--i:1" d="M87.49 31.24L87.49 37.51L93.76 37.51L93.76 31.24Z"/><path class="pol" style="--dx:6.25px;--dy:-12.5px;--i:2" d="M87.51 43.74L81.24 43.74L81.24 50.01L87.51 50.01Z"/><path class="pol" style="--dx:6.25px;--dy:-6.25px;--i:3" d="M74.99 56.24L74.99 62.51L81.26 62.51L81.26 56.24Z"/><path class="pol" style="--dx:6.25px;--dy:-12.5px;--i:4" d="M74.99 81.24L74.99 87.51L81.26 87.51L81.26 81.24Z"/></g><g transform="translate(1243.7 0) scale(0.86)"><path d="M544.9 -132.8Q466.3 20 311 20Q226.1 20 161.1 -24.9Q45.9 -104 45.9 -271Q45.9 -381.3 101.1 -456.1Q150.9 -523.9 233.9 -548.3Q274.9 -560.1 317.9 -560.1Q406.7 -560.1 463.9 -514.6Q515.1 -474.6 515.1 -428.2Q515.1 -411.1 508.3 -396Q493.7 -365.2 459 -365.2Q430.2 -365.2 415 -387.2Q405.8 -399.9 405.8 -417.5Q405.8 -452.6 429.7 -464.8Q398.9 -512.2 318.8 -512.2Q230 -512.2 174.3 -437.5Q126 -372.1 126 -271Q126 -197.3 152.8 -142.6Q177.2 -92.3 220.7 -64Q264.2 -36.1 317.9 -36.1Q438 -36.1 513.7 -165ZM644 0V-36.1Q704.6 -38.6 721.7 -56.6Q736.8 -72.8 736.8 -116.2V-653.3Q736.8 -696.3 717.8 -710Q701.2 -722.2 647 -724.1V-760.3Q735.8 -760.7 807.6 -780.3V-116.2Q807.6 -68.8 825.7 -53.2Q841.8 -39.1 899.4 -36.1V0ZM1381.3 -351.1V-366.2Q1381.3 -437.5 1350.1 -470.7Q1333.9 -487.8 1304.6 -499.5Q1270 -513.2 1232.9 -513.2Q1173.3 -513.2 1134.7 -494.1Q1115.2 -484.9 1109.3 -473.1Q1137.2 -462.4 1137.2 -424.8Q1137.2 -406.7 1127.4 -393.1Q1112.3 -372.1 1083.9 -372.1Q1061.5 -372.1 1046.3 -389.2Q1030.2 -407.7 1030.2 -436.5Q1030.2 -483.9 1085.9 -519.5Q1148.4 -560.1 1235.8 -560.1Q1322.2 -560.1 1380.3 -522.5Q1450.2 -477.1 1450.2 -345.2V-120.1Q1450.2 -50.8 1481.4 -50.8Q1509.2 -50.8 1533.2 -101.1L1562 -64Q1527.3 18.1 1467.2 18.1Q1388.6 18.1 1382.3 -86.9Q1321.2 18.1 1171.3 18.1Q1085.9 18.1 1037.6 -43Q1004.4 -85.4 1004.4 -144Q1004.4 -237.3 1097.6 -290Q1187.9 -341.8 1339.3 -349.1ZM1381.3 -300.8 1344.2 -298.8Q1216.3 -292 1147.4 -253.9Q1081.5 -217.8 1081.5 -147.9Q1081.5 -102.5 1105.9 -75.7Q1134.2 -43.9 1190.4 -43.9Q1245.6 -43.9 1296.3 -70.3Q1350.1 -98.1 1371.5 -139.6Q1381.3 -159.2 1381.3 -178.2ZM1644.5 -195.8H1678.7Q1700.6 -107.9 1757.3 -68.4Q1816.3 -26.9 1879.3 -26.9Q1938.4 -26.9 1975.5 -55.7Q2011.2 -83 2011.2 -123Q2011.2 -166.5 1961.9 -197.8Q1932.1 -216.8 1875.4 -236.8L1847.6 -247.1Q1726 -290 1690.4 -325.7Q1655.2 -360.8 1655.2 -418.5Q1655.2 -480.5 1706.5 -521.5Q1754.3 -560.1 1839.3 -560.1Q1910.6 -560.1 1971.1 -515.1Q1981.9 -506.8 1993.1 -506.8Q2006.8 -506.8 2011.2 -540H2044.4V-377H2006.3Q1989.7 -436 1951.1 -472.2Q1907.2 -513.2 1841.2 -513.2Q1788 -513.2 1758.7 -490.7Q1726.5 -465.8 1726.5 -424.3Q1726.5 -394.5 1754.8 -372.1Q1779.7 -353 1864.2 -323.2L1898.4 -311Q2003.8 -273.9 2044.9 -235.8Q2088.3 -195.3 2088.3 -127.4Q2088.3 -58.6 2031.2 -19Q1975.5 20 1887.6 20Q1807.1 20 1744.6 -22L1742.1 -23.4Q1719.2 -39.1 1712.8 -39.1Q1696.2 -39.1 1678.7 14.2H1644.5ZM2204.5 -195.8H2238.7Q2260.7 -107.9 2317.3 -68.4Q2376.4 -26.9 2439.4 -26.9Q2498.5 -26.9 2535.6 -55.7Q2571.2 -83 2571.2 -123Q2571.2 -166.5 2521.9 -197.8Q2492.1 -216.8 2435.5 -236.8L2407.6 -247.1Q2286.1 -290 2250.4 -325.7Q2215.3 -360.8 2215.3 -418.5Q2215.3 -480.5 2266.5 -521.5Q2314.4 -560.1 2399.3 -560.1Q2470.6 -560.1 2531.2 -515.1Q2541.9 -506.8 2553.1 -506.8Q2566.8 -506.8 2571.2 -540H2604.4V-377H2566.3Q2549.7 -436 2511.2 -472.2Q2467.2 -513.2 2401.3 -513.2Q2348.1 -513.2 2318.8 -490.7Q2286.5 -465.8 2286.5 -424.3Q2286.5 -394.5 2314.9 -372.1Q2339.8 -353 2424.2 -323.2L2458.4 -311Q2563.9 -273.9 2604.9 -235.8Q2648.4 -195.3 2648.4 -127.4Q2648.4 -58.6 2591.2 -19Q2535.6 20 2447.7 20Q2367.1 20 2304.6 -22L2302.2 -23.4Q2279.2 -39.1 2272.9 -39.1Q2256.3 -39.1 2238.7 14.2H2204.5ZM2880.3 -807.1Q2897.4 -807.1 2913.5 -797.4Q2942.3 -778.8 2942.3 -745.1Q2942.3 -720.7 2925.2 -702.6Q2907.1 -683.1 2880.3 -683.1Q2864.6 -683.1 2851 -690.4Q2818.3 -708.5 2818.3 -745.1Q2818.3 -773.4 2839.7 -792Q2857.3 -807.1 2880.3 -807.1ZM2747.5 0V-36.1Q2814.8 -38.6 2831.9 -56.6Q2847.6 -72.8 2847.6 -116.2V-433.1Q2847.6 -473.1 2826.6 -486.3Q2806.5 -499 2757.2 -503.9V-540Q2830.5 -540 2918.4 -560.1V-116.2Q2918.4 -69.3 2936.9 -52.2Q2954 -37.1 3014.1 -36.1V0ZM3201.5 -540V-588.9Q3201.5 -684.1 3262.6 -737.3Q3319.2 -787.1 3413.5 -787.1Q3503.8 -787.1 3552.1 -746.1Q3583.9 -718.8 3583.9 -688.5Q3583.9 -672.9 3576.1 -660.2Q3561.9 -637.2 3533.6 -637.2Q3511.1 -637.2 3495 -651.9Q3480.8 -664.6 3480.8 -683.1Q3480.8 -707 3498.9 -716.3Q3470.6 -743.2 3413.9 -743.2Q3342.2 -743.2 3302.6 -690.9Q3271.4 -650.4 3271.4 -592.3V-540H3434Q3528.2 -540 3609.7 -560.1V-116.2Q3609.7 -69.3 3628.3 -52.2Q3645.4 -37.1 3705.9 -36.1V0H3438.8V-36.1Q3506.2 -38.6 3523.8 -56.6Q3538.9 -72.8 3538.9 -116.2V-418Q3538.9 -464.4 3504.8 -481Q3483.3 -492.2 3434 -492.2H3271.4V-116.2Q3271.4 -68.8 3288.9 -53.7Q3306 -39.1 3363.7 -36.1V0H3107.3V-36.1Q3166.9 -38.6 3184.5 -55.2Q3201.5 -70.8 3201.5 -116.2V-492.2H3092.7V-540ZM3885.6 -275.4V-267.6Q3885.6 -189 3916.9 -131.8Q3969.1 -36.1 4077.5 -36.1Q4197.6 -36.1 4277.7 -159.2L4309.4 -127.4Q4224.5 20 4071.2 20Q3936.4 20 3862.7 -81.1Q3807.5 -156.7 3807.5 -268.1Q3807.5 -382.8 3869 -463.4Q3943.7 -560.1 4065.8 -560.1Q4151.2 -560.1 4214.7 -511.7Q4286 -458 4307.5 -364.7Q4315.3 -331.1 4315.3 -295.4V-275.4ZM4231.3 -323.2Q4227.4 -406.2 4194.7 -449.2Q4146.3 -513.2 4066.8 -513.2Q3992.1 -513.2 3939.3 -449.2Q3897.3 -398.4 3887.6 -323.2ZM4415.4 0V-36.1Q4477.4 -37.6 4493.5 -55.7Q4508.1 -71.8 4508.1 -116.2V-433.1Q4508.1 -474.6 4490.1 -487.8Q4473.5 -500.5 4418.3 -503.9V-540Q4492.5 -540 4574.6 -560.1V-446.8Q4604.3 -495.1 4663.9 -530.8Q4712.2 -560.1 4767.4 -560.1Q4807 -560.1 4831.9 -540Q4860.2 -517.1 4860.2 -476.6Q4860.2 -452.6 4846 -437Q4830.4 -419.9 4804.5 -419.9Q4788.9 -419.9 4776.2 -428.2Q4750.8 -444.8 4750.8 -475.1Q4750.8 -490.7 4761.1 -505.9Q4716.2 -504.9 4672.2 -473.1Q4614.6 -431.6 4578 -367.2V-116.2Q4578 -69.3 4595.1 -54.2Q4613.6 -37.1 4677.1 -36.1V0ZM5029.1 -115.7Q5050.1 -115.7 5069.2 -104.5Q5106.8 -82 5106.8 -37.6Q5106.8 -8.3 5087.2 13.7Q5063.8 40 5028.1 40Q5010.1 40 4993.5 31.7Q4951 9.8 4951 -38.1Q4951 -71.3 4975.4 -94.7Q4997.9 -115.7 5029.1 -115.7ZM5694.1 0 5685.4 -50.8Q5629.2 20 5522.8 20Q5390.9 20 5323 -82Q5272.3 -158.7 5272.3 -277.3Q5272.3 -389.2 5333.8 -468.3Q5405.6 -560.1 5515.9 -560.1Q5584.3 -560.1 5639.5 -520.5Q5669.7 -499 5687.3 -466.8V-652.8Q5687.3 -698.2 5671.2 -709Q5654.6 -720.7 5596.5 -724.1V-760.3Q5681.9 -760.3 5757.1 -780.3V-105Q5757.1 -69.8 5775.7 -53.7Q5792.3 -38.6 5846 -36.1V0ZM5527.6 -503.9Q5462.2 -503.9 5411.4 -448.2Q5351.4 -382.3 5351.4 -277.3Q5351.4 -183.1 5389.9 -118.2Q5440.7 -33.2 5525.2 -33.2Q5591.6 -33.2 5635.1 -73.7Q5667.8 -105 5679 -160.2Q5688.3 -206.1 5688.3 -275.9Q5688.3 -390.6 5647.8 -441.9Q5598.9 -503.9 5527.6 -503.9ZM6015.4 -275.4V-267.6Q6015.4 -189 6046.7 -131.8Q6098.9 -36.1 6207.3 -36.1Q6327.4 -36.1 6407.5 -159.2L6439.2 -127.4Q6354.3 20 6201 20Q6066.2 20 5992.5 -81.1Q5937.3 -156.7 5937.3 -268.1Q5937.3 -382.8 5998.8 -463.4Q6073.5 -560.1 6195.6 -560.1Q6281 -560.1 6344.5 -511.7Q6415.8 -458 6437.3 -364.7Q6445.1 -331.1 6445.1 -295.4V-275.4ZM6361.1 -323.2Q6357.2 -406.2 6324.5 -449.2Q6276.2 -513.2 6196.6 -513.2Q6121.9 -513.2 6069.1 -449.2Q6027.1 -398.4 6017.4 -323.2ZM6532 -540H6766.9V-503.9Q6690.7 -501 6690.7 -477.1Q6690.7 -463.9 6700.9 -440.9L6853.8 -99.1L6986.1 -418Q6996.8 -444.3 6996.8 -465.3Q6996.8 -497.6 6911.9 -503.9V-540H7136V-503.9Q7098.9 -498.5 7076.9 -474.6Q7056.4 -452.6 7038.8 -411.1L6861.1 12.2H6824L6631.1 -428.2Q6614 -466.8 6589.1 -485.8Q6568.6 -502 6532 -503.9Z"/></g></svg></a>
    <nav class="nav__links" aria-label="Primary">
      <button type="button" class="nav__link" data-menu="product" aria-expanded="false" aria-controls="nav-pop">Product<svg class="chev" width="10" height="10" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      <button type="button" class="nav__link" data-menu="developers" aria-expanded="false" aria-controls="nav-pop">Developers<svg class="chev" width="10" height="10" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      <a class="nav__link" href="#pricing">Pricing</a>
      <span class="nav__glider" aria-hidden="true"></span>
    </nav>
    <div class="nav__actions">
      <a class="icon-link" href="https://github.com/mrmps/classifier-dev" aria-label="classifier.dev on GitHub">
        <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
      </a>
      <button type="button" class="icon-link scheme-btn" id="scheme-btn" aria-label="Switch to light">
        <svg class="i-sun" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><circle cx="9" cy="9" r="3.2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M9 1.8v1.8M9 14.4v1.8M1.8 9h1.8M14.4 9h1.8M3.9 3.9l1.3 1.3M12.8 12.8l1.3 1.3M3.9 14.1l1.3-1.3M12.8 5.2l1.3-1.3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        <svg class="i-moon" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M14.8 11.2A6 6 0 0 1 6.8 3.2a6 6 0 1 0 8 8z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>
      </button>
      <a class="btn btn--soft btn--sm nav__login" href="/login">Log in</a>
      <button type="button" class="btn btn--ink btn--sm nav__cta nav__cta--copy" data-copy-prompt><span class="swap-ico" aria-hidden="true"><svg class="i i-copy" aria-hidden="true"><use href="#i-copy"/></svg><svg class="i i-check" aria-hidden="true"><use href="#i-check"/></svg></span><span class="swap"><span>Copy setup prompt</span><span>Copied</span></span></button>
      <a class="btn btn--ink btn--sm nav__cta nav__cta--start" href="/auth/sign-up">Start for free</a>
      <button class="icon-link nav__menu" id="menu-btn" aria-expanded="false" aria-controls="menu" aria-label="Menu">
        <svg class="i-burger" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M2 5.5h14M2 12.5h14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        <svg class="i-x" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M4 4l10 10M14 4L4 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      </button>
    </div>
  </div>
  <div class="nav-pop" id="nav-pop" hidden>
    <div class="nav-pop__panel nav-pop__panel--feat" data-panel="product"><a class="nav-feat" href="#inputs"><span class="nav-feat__art nf" aria-hidden="true"><img class="nf__bg" src="/site/public/fields/audio.webp" alt="" decoding="async"><span class="nf__tile nf__tile--text">Aa</span><img class="nf__tile nf__tile--photo" src="/site/assets/ex/photos/102-dither.png" alt="" decoding="async"><span class="nf__tile nf__tile--wave"><i style="--h:3"></i><i style="--h:6"></i><i style="--h:9"></i><i style="--h:5"></i><i style="--h:8"></i><i style="--h:4"></i><i style="--h:7"></i><i style="--h:10"></i><i style="--h:6"></i><i style="--h:3"></i><i style="--h:5"></i><i style="--h:8"></i></span><span class="nf__tile nf__tile--video"></span></span><b>Fully multimodal</b><span>Text, images, audio and video in one call</span></a><div class="nav-pop__list"><a class="nav-item" href="#benchmarks"><i class="nav-item__ico"><svg class="i" aria-hidden="true"><use href="#i-chart-column"/></svg></i><b>Benchmarks</b><span>Measured against LLMs doing the same job</span></a><a class="nav-item" href="#inputs"><i class="nav-item__ico"><svg class="i" aria-hidden="true"><use href="#i-layers"/></svg></i><b>Inputs</b><span>Text, images, audio, video, pages, documents</span></a><a class="nav-item" href="#use-cases"><i class="nav-item__ico"><svg class="i" aria-hidden="true"><use href="#i-filter"/></svg></i><b>Use cases</b><span>Search, tickets, logs, moderation</span></a><a class="nav-item" href="/chat"><i class="nav-item__ico"><svg class="i" aria-hidden="true"><use href="#i-message-square"/></svg></i><b>Chat</b><span>The classify tools, called live</span></a></div></div>
    <div class="nav-pop__panel nav-pop__panel--feat nav-pop__panel--2" data-panel="developers"><a class="nav-feat" href="/developers"><span class="nav-feat__art" aria-hidden="true"><img class="nf__bg" src="/site/public/fields/api.webp" alt="" decoding="async"><code class="nav-feat__code">curl classifier.dev -d '{<br>&nbsp;&nbsp;"inputs": ["…"],<br>&nbsp;&nbsp;"labels": ["…"]<br>}'</code></span><b>Quickstart</b><span>Your first classification in one request</span></a><div class="nav-pop__list"><a class="nav-item" href="/developers"><i class="nav-item__ico"><svg class="i" aria-hidden="true"><use href="#i-book-open"/></svg></i><b>Docs</b><span>Guides and API reference</span></a><a class="nav-item" href="/mcp-setup"><i class="nav-item__ico"><svg class="i" aria-hidden="true"><use href="#i-plug"/></svg></i><b>MCP setup</b><span>Claude, ChatGPT, Codex, Cursor and others</span></a><a class="nav-item" href="/developers"><i class="nav-item__ico"><svg class="i" aria-hidden="true"><use href="#i-sparkles"/></svg></i><b>Agent skill</b><span>Teach your agent when to classify</span></a><a class="nav-item" href="/developers"><i class="nav-item__ico"><svg class="i" aria-hidden="true"><use href="#i-terminal"/></svg></i><b>CLI</b><span>Classify files from your shell</span></a><a class="nav-item" href="/developers"><i class="nav-item__ico"><svg class="i" aria-hidden="true"><use href="#i-package"/></svg></i><b>SDKs</b><span>Python, Go and TypeSafe</span></a><a class="nav-item" href="/openapi.json"><i class="nav-item__ico"><svg class="i" aria-hidden="true"><use href="#i-file-json"/></svg></i><b>OpenAPI</b><span>The OpenAPI 3.1 specification</span></a></div></div>
  </div>
  <div class="menu" id="menu" hidden>
    <div class="menu__pane" data-pane="root">
      <button type="button" class="menu__row" data-push="product">Product<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 3L7.5 6L4.5 9" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      <button type="button" class="menu__row" data-push="developers">Developers<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 3L7.5 6L4.5 9" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      <a class="menu__row" href="#pricing">Pricing</a>
      <a class="menu__row" href="https://github.com/mrmps/classifier-dev">GitHub</a>
      <a class="menu__row" href="/login">Log in</a>
      <a class="btn btn--ink" href="/auth/sign-up">Start for free</a>
    </div>
    <div class="menu__pane" data-pane="product" hidden>
      <button type="button" class="menu__back" data-pop><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M7.5 3L4.5 6L7.5 9" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>Product</button>
      <a class="nav-item" href="#benchmarks"><i class="nav-item__ico"><svg class="i" aria-hidden="true"><use href="#i-chart-column"/></svg></i><b>Benchmarks</b><span>Measured against LLMs doing the same job</span></a><a class="nav-item" href="#inputs"><i class="nav-item__ico"><svg class="i" aria-hidden="true"><use href="#i-layers"/></svg></i><b>Inputs</b><span>Text, images, audio, video, pages, documents</span></a><a class="nav-item" href="#use-cases"><i class="nav-item__ico"><svg class="i" aria-hidden="true"><use href="#i-filter"/></svg></i><b>Use cases</b><span>Search, tickets, logs, moderation</span></a><a class="nav-item" href="/chat"><i class="nav-item__ico"><svg class="i" aria-hidden="true"><use href="#i-message-square"/></svg></i><b>Chat</b><span>The classify tools, called live</span></a>
    </div>
    <div class="menu__pane" data-pane="developers" hidden>
      <button type="button" class="menu__back" data-pop><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M7.5 3L4.5 6L7.5 9" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>Developers</button>
      <a class="nav-item" href="/developers"><i class="nav-item__ico"><svg class="i" aria-hidden="true"><use href="#i-book-open"/></svg></i><b>Docs</b><span>Guides and API reference</span></a><a class="nav-item" href="/mcp-setup"><i class="nav-item__ico"><svg class="i" aria-hidden="true"><use href="#i-plug"/></svg></i><b>MCP setup</b><span>Claude, ChatGPT, Codex, Cursor and others</span></a><a class="nav-item" href="/developers"><i class="nav-item__ico"><svg class="i" aria-hidden="true"><use href="#i-sparkles"/></svg></i><b>Agent skill</b><span>Teach your agent when to classify</span></a><a class="nav-item" href="/developers"><i class="nav-item__ico"><svg class="i" aria-hidden="true"><use href="#i-terminal"/></svg></i><b>CLI</b><span>Classify files from your shell</span></a><a class="nav-item" href="/developers"><i class="nav-item__ico"><svg class="i" aria-hidden="true"><use href="#i-package"/></svg></i><b>SDKs</b><span>Python, Go and TypeSafe</span></a><a class="nav-item" href="/openapi.json"><i class="nav-item__ico"><svg class="i" aria-hidden="true"><use href="#i-file-json"/></svg></i><b>OpenAPI</b><span>The OpenAPI 3.1 specification</span></a>
    </div>
  </div>
</header>

<main id="main">

<!-- HERO -->
<section class="sec hero" id="top" aria-labelledby="hero-title">
  <div class="rail hero__rail">
    <div class="hero__guides" aria-hidden="true"></div>
    <div class="hero__head">
      <a class="announce" href="/developers" data-load><span class="announce__tag">New</span><span>Images, audio and video with Jev-Omni</span></a>
      <h1 class="t-hero hero__title" id="hero-title" data-words>Fast, zero-&#8288;shot, multimodal classification</h1>
      <p class="t-lede hero__lede" data-load>Name your labels, send text, images, audio or video, and get one of your labels back with a confidence. Free for agents, with no key or account.</p>
      <div class="hero__ctas" data-load>
        <div class="split-btn split-btn--ink" data-split>
          <button type="button" class="split-btn__main" data-copy-prompt>
            <span class="swap-ico swap-ico--agents" aria-hidden="true"><span class="agents i-copy"><i><img src="/site/assets/logos/claude-color.svg" alt="" width="12" height="12"></i><i><img src="/site/assets/logos/codex-color.svg" alt="" width="12" height="12"></i><i><img src="/site/assets/logos/cursor.svg" alt="" width="12" height="12"></i><i><img src="/site/assets/logos/grok.svg" alt="" width="12" height="12"></i><i><svg class="i" aria-hidden="true"><use href="#si-googlegemini"/></svg></i></span><span class="agents__ok i-check"><svg class="i"><use href="#i-check"/></svg></span></span>
            <span class="swap"><span>Copy setup prompt</span><span>Copied</span></span>
          </button>
          <div class="menu-pop" role="group" aria-label="Open the setup prompt in" hidden>
            <p class="menu-pop__label" aria-hidden="true">Open with the prompt in</p>
            <a class="menu-pop__item" data-deeplink="claude"><img src="/site/assets/logos/claudecode-color.svg" alt="" width="16" height="16"><span>Claude Code</span><svg class="ext" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M8.5 2.5h3v3M11.5 2.5l-5 5M10.5 8.5V11a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1H6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg></a>
            <a class="menu-pop__item" data-deeplink="codex"><img src="/site/assets/logos/codex-color.svg" alt="" width="16" height="16"><span>Codex</span><svg class="ext" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M8.5 2.5h3v3M11.5 2.5l-5 5M10.5 8.5V11a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1H6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg></a>
            <a class="menu-pop__item" data-deeplink="cursor"><img src="/site/assets/logos/cursor.svg" alt="" width="16" height="16"><span>Cursor</span><svg class="ext" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M8.5 2.5h3v3M11.5 2.5l-5 5M10.5 8.5V11a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1H6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg></a>
            <a class="menu-pop__item" data-deeplink="grok"><img src="/site/assets/logos/grok.svg" alt="" width="16" height="16"><span>Grok</span><svg class="ext" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M8.5 2.5h3v3M11.5 2.5l-5 5M10.5 8.5V11a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1H6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg></a>
          <button type="button" class="menu-pop__item menu-pop__more" data-install><span>More ways to install</span></button>
</div>
          <button type="button" class="split-btn__more" aria-haspopup="menu" aria-expanded="false" aria-label="Open in your agent, or other ways to install">
            <svg class="chev" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
        <a class="btn btn--soft" href="/auth/sign-up" id="hero-cta">Start for free</a>
      </div>
    </div>

    <script>(function(){if(innerWidth<768)return;var r=document.querySelector('.hero__rail'),d=document.querySelector('.hero__head');r.style.paddingTop=Math.max(72,Math.round((innerHeight-61)/2-d.offsetHeight/2))+'px'})()</script>
    <div class="playground" id="playground" data-load>
      <form class="composer" id="composer" autocomplete="off" novalidate>
        <div class="composer__top">
          <label class="sr" for="text">Text to classify</label>
          <div class="att-slot" id="att-slot" hidden></div>
          <textarea id="text" rows="1" spellcheck="false" data-lenis-prevent aria-describedby="text-help"></textarea>
          <span class="sr" id="text-help">One item per line. You can also paste a long list, or drop a text file, photo, audio clip or video.</span>
          <div class="ph" id="ph" aria-hidden="true"><span class="ph__line">Paste any text, one item per line</span></div>
          <div class="drop-cue" id="drop-cue" aria-hidden="true"><span class="drop-cue__ico"></span><span class="drop-cue__t"></span></div>
          <div class="reveal" id="instr-reveal"><div>
            <div class="composer__row composer__instr">
              <label class="composer__cap" for="instr">Instructions</label>
              <input id="instr" type="text" placeholder="Optional, like what counts as billing">
              <button type="button" class="x" id="instr-x" aria-label="Remove instructions"><svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg></button>
            </div>
          </div></div>
        </div>
        <div class="reveal" id="labels-reveal"><div>
          <div class="composer__row composer__labels">
            <span class="sr" id="labels-cap">Labels</span>
            <div class="label-sets" id="label-sets" role="group" aria-label="Use a set of labels" hidden>
              <button type="button" data-set="bug,feature,billing">bug, feature, billing</button>
              <button type="button" data-set="positive,negative,neutral">positive, negative, neutral</button>
              <button type="button" data-set="spam,not spam">spam, not spam</button>
            </div>
            <div class="labels" id="labels" role="group" aria-labelledby="labels-cap">
              <input id="label-input" type="text" aria-label="Add a label, then press Enter" placeholder="Add your own labels" enterkeyhint="done">
            </div>
          </div>
        </div></div>
        <div class="composer__bar">
          <button type="button" class="icon-btn" id="attach" aria-label="Add a file">
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M9 3.5v11M3.5 9h11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
          </button>
          <div class="composer__meta" id="meta" hidden>
            <button type="button" class="ghost-btn" id="instr-add" aria-controls="instr-reveal" aria-expanded="false"><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 2v8M2 6h8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>Add instructions</button>
            <span class="count" id="count"></span>
          </div>
          <input type="file" id="file" accept=".txt,.csv,.json,.md,.log,text/plain,image/png,image/jpeg,image/webp,audio/*,video/mp4,video/webm" hidden>
          <button type="submit" class="btn btn--ink btn--sm" id="classify" aria-disabled="true"><span class="classify__label">Classify</span></button>
        </div>
      </form>
      <div class="reveal hint-wrap" id="hint-wrap"><div><p class="hint" id="hint"></p></div></div>

      <div class="log-wrap" id="log-wrap" hidden><ol class="log" id="log" aria-label="Your runs, newest first"></ol></div>

      <div class="examples" id="examples">
        <p class="examples__label">Or try an example</p>
        <ul class="files" role="list">
          <li style="--side:-1;--f:.55;--y:6px;--r:-3deg"><button class="file" data-ex="photos" aria-describedby="file-help"><span class="thumb thumb--photos" aria-hidden="true"><img src="/site/assets/ex/photos/219-s.webp" alt="" width="60" height="45" decoding="async"><img src="/site/assets/ex/photos/43-s.webp" alt="" width="60" height="45" decoding="async"><img src="/site/assets/ex/photos/237-s.webp" alt="" width="60" height="45" decoding="async"></span><span class="file__name">photo-library</span><span class="file__meta">12 photos</span></button></li>
          <li style="--side:1;--f:.3;--y:-10px;--r:2deg"><button class="file" data-ex="voicemails" aria-describedby="file-help"><span class="thumb thumb--audio" aria-hidden="true"><svg width="40" height="22" viewBox="0 0 40 22"><rect x="0" y="8.0" width="2" height="6.0" rx="1"/><rect x="4" y="5.0" width="2" height="12.0" rx="1"/><rect x="8" y="2.0" width="2" height="18.0" rx="1"/><rect x="12" y="6.0" width="2" height="10.0" rx="1"/><rect x="16" y="1.0" width="2" height="20.0" rx="1"/><rect x="20" y="4.0" width="2" height="14.0" rx="1"/><rect x="24" y="7.0" width="2" height="8.0" rx="1"/><rect x="28" y="3.0" width="2" height="16.0" rx="1"/><rect x="32" y="0.0" width="2" height="22.0" rx="1"/><rect x="36" y="5.0" width="2" height="12.0" rx="1"/></svg></span><span class="file__name">voicemails</span><span class="file__meta">6 clips</span></button></li>
          <li style="--side:1;--f:.75;--y:150px;--r:-2deg"><button class="file" data-ex="recordings" aria-describedby="file-help"><span class="thumb thumb--video" aria-hidden="true"><img src="/site/assets/ex/recordings/export-fails.webp" alt="" width="96" height="60" decoding="async"><i></i></span><span class="file__name">screen-recordings</span><span class="file__meta">3 videos</span></button></li>
          <li style="--side:-1;--f:.2;--y:176px;--r:2deg"><button class="file" data-ex="tickets" aria-describedby="file-help"><span class="thumb thumb--txt" aria-hidden="true"></span><span class="file__name">support-tickets.txt</span><span class="file__meta">1,000 tickets</span></button></li>
          <li class="file--desk" style="--side:-1;--f:.7;--y:330px;--r:-1deg"><button class="file" data-ex="search" aria-describedby="file-help"><span class="thumb thumb--json" aria-hidden="true"></span><span class="file__name">search-results.json</span><span class="file__meta">40 results</span></button></li>
          <li class="file--desk" style="--side:1;--f:.35;--y:320px;--r:3deg"><button class="file" data-ex="logs" aria-describedby="file-help"><span class="thumb thumb--log" aria-hidden="true"></span><span class="file__name">server-logs.txt</span><span class="file__meta">400 lines</span></button></li>
        </ul>
        <span class="sr" id="file-help">Click or press Enter to classify it. Space previews it.</span>
      </div>
    </div>
  </div>
</section>

<div class="gap" aria-hidden="true"><div class="rail"></div></div>

<!-- BENCHMARKS -->
<section class="sec" id="benchmarks" aria-labelledby="bench-title">
  <div class="rail">
    <div class="sec-head">
      <div class="sec-head__copy">
        <h2 class="t-title" id="bench-title" data-words>Benchmarks</h2>
        <p class="t-body">Measured against LLMs doing the same job.</p>
      </div>
      <a class="btn btn--soft btn--sm" href="/benchmark"><svg class="i" aria-hidden="true"><use href="#i-chart-column"/></svg>Full benchmark</a>
    </div>

    <div class="cells cells--2">
      <div class="cell" data-rise>
        <div class="cell__top">
          <h3 class="cell__title" data-bench-title>Accuracy</h3>
          <div class="seg" role="group" aria-label="Test set" data-bench-set>
            <button type="button" data-set="news" aria-pressed="true">AG News</button>
            <button type="button" data-set="emotion" aria-pressed="false">Emotion</button>
            <button type="button" data-set="multi" aria-pressed="false">Multi-label</button>
          </div>
        </div>
        <div class="bench-swap" data-bench-swap aria-live="polite">
          <p class="cell__body">Accuracy of sorting news headlines into 4 topics.</p>
          <div class="bars" role="img" aria-label="AG News accuracy: classifier.dev 87.7%, qwen3.7-flash 87.5%, ling-3.0-flash 82.0%, granite-4.0-h-micro 63.2%">
            <div class="bars__row is-us"><span class="bars__name">classifier.dev<small>Fast mode</small></span><span class="bars__track"><span class="bars__bar" style="--v:.877"></span></span><span class="bars__num">87.7%</span></div>
            <div class="bars__row"><span class="bars__name">qwen3.7-flash<small>reasoning LLM</small></span><span class="bars__track"><span class="bars__bar" style="--v:.875"></span></span><span class="bars__num">87.5%</span></div>
            <div class="bars__row"><span class="bars__name">ling-3.0-flash<small>fast LLM</small></span><span class="bars__track"><span class="bars__bar" style="--v:.82"></span></span><span class="bars__num">82.0%</span></div>
            <div class="bars__row"><span class="bars__name">granite-4.0-h-micro<small>small LLM</small></span><span class="bars__track"><span class="bars__bar" style="--v:.632"></span></span><span class="bars__num">63.2%</span></div>
          </div>
        </div>
      </div>
      <div class="cell" data-rise>
        <div class="cell__top"><h3 class="cell__title">Speed</h3></div>
        <p class="cell__body">Headlines sorted per second. Higher is faster.</p>
        <div class="bars" role="img" aria-label="Headlines per second: classifier.dev 500, granite-4.0-h-micro 1.7, ling-3.0-flash 1.4, qwen3.7-flash 0.3">
          <div class="bars__row is-us"><span class="bars__name">classifier.dev<small>Fast mode</small></span><span class="bars__track"><span class="bars__bar" style="--v:1"></span></span><span class="bars__num">500</span></div>
          <div class="bars__row"><span class="bars__name">granite-4.0-h-micro<small>small LLM</small></span><span class="bars__track"><span class="bars__bar bars__bar--min" style="--v:.0034"></span></span><span class="bars__num">1.7</span></div>
          <div class="bars__row"><span class="bars__name">ling-3.0-flash<small>fast LLM</small></span><span class="bars__track"><span class="bars__bar bars__bar--min" style="--v:.0027"></span></span><span class="bars__num">1.4</span></div>
          <div class="bars__row"><span class="bars__name">qwen3.7-flash<small>reasoning LLM</small></span><span class="bars__track"><span class="bars__bar bars__bar--min" style="--v:.0006"></span></span><span class="bars__num">0.3</span></div>
        </div>
      </div>
    </div>

    <div class="cells cells--2">
      <div class="cell" data-rise>
        <div class="cell__top"><h3 class="cell__title">Accuracy of confident answers</h3></div>
        <p class="cell__body">Accuracy of answers given a confidence score of 90% or more, on AG News.</p>
        <div class="bars" role="img" aria-label="Accuracy of confident answers: classifier.dev 91.6%, granite-4.0-h-micro 68%">
          <div class="bars__row is-us"><span class="bars__name">classifier.dev<small>Fast mode</small></span><span class="bars__track"><span class="bars__bar" style="--v:.916"></span></span><span class="bars__num">91.6%</span></div>
          <div class="bars__row"><span class="bars__name">granite-4.0-h-micro<small>small LLM</small></span><span class="bars__track"><span class="bars__bar" style="--v:.68"></span></span><span class="bars__num">68%</span></div>
        </div>
      </div>
      <div class="cell" data-rise>
        <div class="cell__top"><h3 class="cell__title">Smart mode</h3></div>
        <p class="cell__body">Smart mode sends unsure answers (less than <data value="smart.below">70%</data> confidence) to a reasoning model for a second look.</p>
        <div class="bars bars--grouped" role="img" aria-label="Accuracy on the 49 unsure AG News headlines: Fast mode 65.3%, Smart mode 83.7%. Accuracy on the 122 unsure emotion messages: Fast mode 36.9%, Smart mode 41.8%">
          <p class="bars__group">Accuracy on the 49 unsure AG News headlines</p>
          <div class="bars__row"><span class="bars__name">Fast mode</span><span class="bars__track"><span class="bars__bar" style="--v:.653"></span></span><span class="bars__num">65.3%</span></div>
          <div class="bars__row is-us"><span class="bars__name">Smart mode</span><span class="bars__track"><span class="bars__bar" style="--v:.837"></span></span><span class="bars__num">83.7%</span></div>
          <p class="bars__group">Accuracy on the 122 unsure emotion messages</p>
          <div class="bars__row"><span class="bars__name">Fast mode</span><span class="bars__track"><span class="bars__bar" style="--v:.369"></span></span><span class="bars__num">36.9%</span></div>
          <div class="bars__row is-us"><span class="bars__name">Smart mode</span><span class="bars__track"><span class="bars__bar" style="--v:.418"></span></span><span class="bars__num">41.8%</span></div>
        </div>
      </div>
    </div>
  </div>
</section>

<div class="gap" aria-hidden="true"><div class="rail"></div></div>

<!-- INPUTS -->
<section class="sec field" id="inputs" aria-labelledby="inputs-title" data-field="accent" data-scheme="light">
  <div class="rail">
    <div class="sec-head">
      <div class="sec-head__copy">
        <h2 class="t-title" id="inputs-title" data-words>Fully multimodal</h2>
        <p class="t-body">Send text, images, audio or video and get one of your labels back. Web pages and long documents work too.</p>
      </div>
    </div>
    <div class="cells bento">
      <div class="cell input input--text" data-rise>
        <div class="input__visual" role="img" aria-label="Three support tickets, labelled billing, bug and feature"><div class="mk mk--text"><p class="mk__bar"><svg class="i"><use href="#i-message-square"/></svg><span>support-tickets.txt</span><span class="mk__n">3 of 1,000</span></p><ul><li><span>We were billed for 31 seats but only have 6 people</span><span class="res" style="--c:var(--split-0)"><i></i>billing<b>1.00</b></span></li><li><span>The app logs me out every day on iOS 18</span><span class="res" style="--c:var(--split-2)"><i></i>bug<b>1.00</b></span></li><li><span>Could you add syntax highlighting for Kotlin?</span><span class="res" style="--c:var(--split-1)"><i></i>feature<b>1.00</b></span></li></ul></div></div>
        <div class="input__copy"><h3 class="cell__title">Text</h3><p class="cell__body">Up to <data value="max.inputs">1,000</data> items per request</p></div>
      </div>
      <div class="cell input input--images" data-rise>
        <div class="input__visual" role="img" aria-label="Two photos from the example library, labelled animal and city"><div class="mk mk--images"><figure><img src="/site/assets/ex/photos/237.webp" alt="" loading="lazy" decoding="async"><span class="res" style="--c:var(--split-0)"><i></i>animal</span></figure><figure><img src="/site/assets/ex/photos/43.webp" alt="" loading="lazy" decoding="async"><span class="res" style="--c:var(--split-1)"><i></i>city</span></figure></div></div>
        <div class="input__copy"><h3 class="cell__title">Images</h3><p class="cell__body">One or two per request. PNG, JPEG or WebP</p></div>
      </div>
      <div class="cell input input--audio" data-rise>
        <div class="input__visual" role="img" aria-label="A nine-second voicemail, labelled refund"><div class="mk mk--audio"><p class="mk__bar"><span class="mk__play" aria-hidden="true"></span><span>vm-0412.m4a</span><span class="mk__n">0:09</span></p><span class="mk__wave"><i style="--p:0.84"></i><i style="--p:0.46"></i><i style="--p:0.59"></i><i style="--p:0.60"></i><i style="--p:0.89"></i><i style="--p:0.79"></i><i style="--p:0.80"></i><i style="--p:0.82"></i><i style="--p:0.81"></i><i style="--p:0.34"></i><i style="--p:0.66"></i><i style="--p:0.63"></i><i style="--p:0.77"></i><i style="--p:0.55"></i><i style="--p:0.65"></i><i style="--p:0.94"></i><i style="--p:0.62"></i><i style="--p:0.12"></i><i style="--p:0.73"></i><i style="--p:0.81"></i><i style="--p:0.69"></i><i style="--p:0.73"></i><i style="--p:0.84"></i><i style="--p:0.80"></i><i style="--p:0.90"></i><i style="--p:0.77"></i><i style="--p:0.85"></i><i style="--p:0.12"></i><i style="--p:0.74"></i><i style="--p:0.57"></i><i style="--p:0.12"></i><i style="--p:0.77"></i><i style="--p:0.78"></i><i style="--p:1.00"></i><i style="--p:0.88"></i><i style="--p:0.77"></i><i style="--p:0.88"></i><i style="--p:0.93"></i><i style="--p:0.60"></i><i style="--p:0.12"></i></span><span class="res" style="--c:var(--split-0)"><i></i>refund</span></div></div>
        <div class="input__copy"><h3 class="cell__title">Audio</h3><p class="cell__body">One clip per request, up to 30 seconds. WAV, MP3, AAC or Opus</p></div>
      </div>
      <div class="cell input input--video" data-rise>
        <div class="input__visual" role="img" aria-label="A screen recording read as 16 frames, labelled shows a bug"><div class="mk mk--video"><div class="mk__body"><div class="mk__screen"><video src="/site/assets/ex/recordings/export-fails.mp4" poster="/site/assets/ex/recordings/export-fails.webp" muted loop playsinline preload="none"></video></div><p class="mk__frames" aria-hidden="true"><i style="--f:0"></i><i style="--f:1"></i><i style="--f:2"></i><i style="--f:3"></i><i style="--f:4"></i><i style="--f:5"></i><i style="--f:6"></i><i style="--f:7"></i><i style="--f:8"></i><i style="--f:9"></i><i style="--f:10"></i><i style="--f:11"></i><i style="--f:12"></i><i style="--f:13"></i><i style="--f:14"></i><i style="--f:15"></i></p></div><p class="mk__bar mk__bar--foot"><span>export-fails.mp4</span><span class="mk__n">16 frames · 0:05</span></p><span class="res" style="--c:var(--split-2)"><i></i>shows a bug</span></div></div>
        <div class="input__copy"><h3 class="cell__title">Video</h3><p class="cell__body">One clip per request. MP4 or WebM, read as 16 frames</p></div>
      </div>
      <div class="cell input input--page" data-rise>
        <div class="input__visual" role="img" aria-label="A documentation page on rate limits, labelled worth opening"><div class="mk mk--page"><p class="mk__url"><i></i><i></i><i></i><span><svg class="i"><use href="#i-lock"/></svg>docs.stripe.com/rate-limits</span></p><div class="mk__doc"><b>Rate limits</b><span>Learn about API rate limits and how to work with them.</span><i></i><i></i><i></i><code>HTTP 429 Too Many Requests</code><i></i><i></i></div><span class="res" style="--c:var(--split-0)"><i></i>worth opening</span></div></div>
        <div class="input__copy"><h3 class="cell__title">Web pages</h3><p class="cell__body">Send a public URL and it reads the page. Needs a paid plan or a top-up</p></div>
      </div>
      <div class="cell input input--doc" data-rise>
        <div class="input__visual" role="img" aria-label="A 184-page contract, labelled contract"><div class="mk mk--doc"><div class="mk__pages"><span></span><span></span><span><b>Master Services Agreement</b><i></i><i></i><i></i><i></i><i></i><i></i></span></div><p class="mk__bar mk__bar--foot"><svg class="i"><use href="#i-file-json"/></svg><span>acme-msa-2026.pdf</span><span class="mk__n">184 pages</span></p><span class="res" style="--c:var(--split-1)"><i></i>contract</span></div></div>
        <div class="input__copy"><h3 class="cell__title">Documents</h3><p class="cell__body">One document of up to <data value="long.tokens">10 million</data> tokens. Needs a paid plan or a top-up</p></div>
      </div>
    </div>
  </div>
</section>

<div class="gap" aria-hidden="true"><div class="rail"></div></div>

<!-- USE CASES: pick one on the left, watch it on the right -->
<section class="sec" id="use-cases" aria-labelledby="uses-title">
  <div class="rail">
    <div class="sec-head">
      <div class="sec-head__copy">
        <h2 class="t-title" id="uses-title" data-words>Use cases</h2>
        <p class="t-body">For anything you'd rather not read item by item.</p>
      </div>
    </div>
    <div class="uses" data-rise>
      <div class="uses__nav" role="tablist" aria-orientation="vertical" aria-label="Use cases" data-tabs="uses">
        <button role="tab" id="ut-search" aria-controls="up-search" aria-selected="true"><span class="uses__ico"><svg class="i" aria-hidden="true"><use href="#i-search"/></svg></span><span class="uses__t">Filter search results</span><span class="uses__d"><span>Your agent reads 7 results, not 40</span></span></button>
        <button role="tab" id="ut-tickets" aria-controls="up-tickets" aria-selected="false" tabindex="-1"><span class="uses__ico"><svg class="i" aria-hidden="true"><use href="#i-ticket"/></svg></span><span class="uses__t">Route support tickets</span><span class="uses__d"><span>The sure ones route themselves</span></span></button>
        <button role="tab" id="ut-logs" aria-controls="up-logs" aria-selected="false" tabindex="-1"><span class="uses__ico"><svg class="i" aria-hidden="true"><use href="#i-scroll-text"/></svg></span><span class="uses__t">Bucket logs and errors</span><span class="uses__d"><span>Thousands of lines, a handful of buckets</span></span></button>
        <button role="tab" id="ut-pre" aria-controls="up-pre" aria-selected="false" tabindex="-1"><span class="uses__ico"><svg class="i" aria-hidden="true"><use href="#i-filter"/></svg></span><span class="uses__t">Pre-filter before an LLM</span><span class="uses__d"><span>Spend reasoning only on what's left</span></span></button>
        <button role="tab" id="ut-mod" aria-controls="up-mod" aria-selected="false" tabindex="-1"><span class="uses__ico"><svg class="i" aria-hidden="true"><use href="#i-shield-check"/></svg></span><span class="uses__t">Moderate uploads</span><span class="uses__d"><span>Images and clips, before they go live</span></span></button>
      </div>
      <div class="tab-panels uses__panels">
        <div class="use-panel" role="tabpanel" id="up-search" aria-labelledby="ut-search">
          <div class="stage" data-scene="search" role="img" aria-label="Search results for stripe rate limits get labelled worth opening or skip. The skipped ones drop out, leaving 7 of 40 for the agent to open."></div>
          <div class="use-panel__copy">
            <p>An agent's search comes back with 40 results. One call labels each one, and the agent opens only the 7 worth reading. The rest never enter its context.</p>
            <button class="link-btn" data-try="search">Try it on 40 results<svg class="i i-go" aria-hidden="true"><use href="#i-arrow-right"/></svg></button>
          </div>
        </div>
        <div class="use-panel" role="tabpanel" id="up-tickets" aria-labelledby="ut-tickets" hidden>
          <div class="stage" data-scene="tickets" role="img" aria-label="Support tickets arrive one at a time, get a label and a confidence, and move into Billing, Bug, Feature or Other. Tickets under 70% confidence go to a person."></div>
          <div class="use-panel__copy">
            <p>Every ticket comes back with a label and a confidence. Send the sure ones straight to their queue, and anything under 70% to a person.</p>
            <button class="link-btn" data-try="tickets">Try it on 1,000 tickets<svg class="i i-go" aria-hidden="true"><use href="#i-arrow-right"/></svg></button>
          </div>
        </div>
        <div class="use-panel" role="tabpanel" id="up-logs" aria-labelledby="ut-logs" hidden>
          <div class="stage" data-scene="logs" role="img" aria-label="400 server log lines stream past and each gets a bucket: auth 98, none of these 95, database 85, timeout 71, disk 51."></div>
          <div class="use-panel__copy">
            <p>Send up to <data value="max.inputs">1,000</data> lines per request and count what's breaking. The labels are yours, so the buckets match how your team works.</p>
            <button class="link-btn" data-try="logs">Try it on 400 log lines<svg class="i i-go" aria-hidden="true"><use href="#i-arrow-right"/></svg></button>
          </div>
        </div>
        <div class="use-panel" role="tabpanel" id="up-pre" aria-labelledby="ut-pre" hidden>
          <div class="stage" data-scene="pre" role="img" aria-label="Example: an inbox of 10,000 emails is sorted into lead or not a lead. Only the 1,200 leads go on to the LLM, which drafts their replies; 8,800 are dropped before it."></div>
          <div class="use-panel__copy">
            <p>Run everything through classifier.dev first and drop the obvious no's. Only what's left goes on to the expensive model.</p>
          </div>
        </div>
        <div class="use-panel" role="tabpanel" id="up-mod" aria-labelledby="ut-mod" hidden>
          <div class="stage" data-scene="mod" role="img" aria-label="Example: five uploads are checked as they arrive. Four photos go live; one video clip is held for a person to review."></div>
          <div class="use-panel__copy">
            <p>Check uploads before they go live: one or two images per request, or one short video or audio clip.</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</section>

<div class="gap" aria-hidden="true"><div class="rail"></div></div>

<!-- CONNECT: how first (skill, MCP, CLI, API), then which agent -->
<section class="sec art-field" id="connect" aria-labelledby="connect-title">
  <div class="rail">
    <div class="sec-head">
      <div class="sec-head__copy">
        <h2 class="t-title" id="connect-title" data-words>Connect your agent</h2>
        <p class="t-body">Install the skill in a coding agent, add the MCP server to any client, or call the API directly.</p>
      </div>
      <a class="btn btn--soft btn--sm" href="/mcp-setup"><svg class="i" aria-hidden="true"><use href="#i-plug"/></svg>MCP setup guide</a>
    </div>

    <div class="install" data-rise>
      <div class="tabs install__methods" role="tablist" aria-label="How to connect" data-tabs="method">
        <button role="tab" id="mt-skill" aria-controls="mp-skill" aria-selected="true"><svg class="i" aria-hidden="true"><use href="#i-sparkles"/></svg>Skill</button>
        <button role="tab" id="mt-mcp" aria-controls="mp-mcp" aria-selected="false" tabindex="-1"><svg class="i" aria-hidden="true"><use href="#i-plug"/></svg>MCP</button>
        <button role="tab" id="mt-cli" aria-controls="mp-cli" aria-selected="false" tabindex="-1"><svg class="i" aria-hidden="true"><use href="#i-terminal"/></svg>CLI</button>
        <button role="tab" id="mt-api" aria-controls="mp-api" aria-selected="false" tabindex="-1"><svg class="i" aria-hidden="true"><use href="#i-code"/></svg>API</button>
        <span class="tabs__glider" aria-hidden="true"></span>
      </div>
      <div class="tab-panels">

        <div class="method" role="tabpanel" id="mp-skill" aria-labelledby="mt-skill">
          <div class="method__side">
            <div class="vtabs" role="tablist" aria-orientation="vertical" aria-label="Coding agent" data-tabs="skill">
              <button role="tab" id="st-claude" aria-controls="sp-claude" aria-selected="true"><img src="/site/assets/logos/claudecode-color.svg" alt="" width="16" height="16"><span>Claude Code</span></button>
              <button role="tab" id="st-codex" aria-controls="sp-codex" aria-selected="false" tabindex="-1"><img src="/site/assets/logos/codex-color.svg" alt="" width="16" height="16"><span>Codex</span></button>
              <button role="tab" id="st-cursor" aria-controls="sp-cursor" aria-selected="false" tabindex="-1"><img src="/site/assets/logos/cursor.svg" alt="" width="16" height="16"><span>Cursor</span></button>
              <button role="tab" id="st-grok" aria-controls="sp-grok" aria-selected="false" tabindex="-1"><img src="/site/assets/logos/grok.svg" alt="" width="16" height="16"><span>Grok</span></button>
              <button role="tab" id="st-any" aria-controls="sp-any" aria-selected="false" tabindex="-1"><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M4.5 6l2 2-2 2M8 10.5h3.5" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Any other agent</span></button>
            </div>
          </div>
          <div class="tab-panels method__main">
            <div class="ipanel" role="tabpanel" id="sp-claude" aria-labelledby="st-claude">
              <p class="ipanel__how">Paste this into Claude Code, or open it there with the prompt filled in.</p>
              <div class="codeblock"><pre data-prompt></pre><button class="copy" data-copy-prompt aria-label="Copy setup prompt"><span class="swap-ico" aria-hidden="true"><svg class="i i-copy" aria-hidden="true"><use href="#i-copy"/></svg><svg class="i i-check" aria-hidden="true"><use href="#i-check"/></svg></span><span class="swap"><span>Copy</span><span>Copied</span></span></button></div>
              <a class="btn btn--soft btn--sm" data-deeplink="claude"><img src="/site/assets/logos/claudecode-color.svg" alt="" width="14" height="14">Open in Claude Code</a>
            </div>
            <div class="ipanel" role="tabpanel" id="sp-codex" aria-labelledby="st-codex" hidden>
              <p class="ipanel__how">Paste this into Codex, or open it there with the prompt filled in.</p>
              <div class="codeblock"><pre data-prompt></pre><button class="copy" data-copy-prompt aria-label="Copy setup prompt"><span class="swap-ico" aria-hidden="true"><svg class="i i-copy" aria-hidden="true"><use href="#i-copy"/></svg><svg class="i i-check" aria-hidden="true"><use href="#i-check"/></svg></span><span class="swap"><span>Copy</span><span>Copied</span></span></button></div>
              <a class="btn btn--soft btn--sm" data-deeplink="codex"><img src="/site/assets/logos/codex-color.svg" alt="" width="14" height="14">Open in Codex</a>
            </div>
            <div class="ipanel" role="tabpanel" id="sp-cursor" aria-labelledby="st-cursor" hidden>
              <p class="ipanel__how">Paste this into Cursor, or open it there with the prompt filled in.</p>
              <div class="codeblock"><pre data-prompt></pre><button class="copy" data-copy-prompt aria-label="Copy setup prompt"><span class="swap-ico" aria-hidden="true"><svg class="i i-copy" aria-hidden="true"><use href="#i-copy"/></svg><svg class="i i-check" aria-hidden="true"><use href="#i-check"/></svg></span><span class="swap"><span>Copy</span><span>Copied</span></span></button></div>
              <a class="btn btn--soft btn--sm" data-deeplink="cursor"><img src="/site/assets/logos/cursor.svg" alt="" width="14" height="14">Open in Cursor</a>
            </div>
            <div class="ipanel" role="tabpanel" id="sp-grok" aria-labelledby="st-grok" hidden>
              <p class="ipanel__how">Paste this into Grok, or open it there with the prompt filled in.</p>
              <div class="codeblock"><pre data-prompt></pre><button class="copy" data-copy-prompt aria-label="Copy setup prompt"><span class="swap-ico" aria-hidden="true"><svg class="i i-copy" aria-hidden="true"><use href="#i-copy"/></svg><svg class="i i-check" aria-hidden="true"><use href="#i-check"/></svg></span><span class="swap"><span>Copy</span><span>Copied</span></span></button></div>
              <a class="btn btn--soft btn--sm" data-deeplink="grok"><img src="/site/assets/logos/grok.svg" alt="" width="14" height="14">Open in Grok</a>
            </div>
            <div class="ipanel" role="tabpanel" id="sp-any" aria-labelledby="st-any" hidden>
              <p class="ipanel__how">Paste this into any agent that can run commands on your computer.</p>
              <div class="codeblock"><pre data-prompt></pre><button class="copy" data-copy-prompt aria-label="Copy setup prompt"><span class="swap-ico" aria-hidden="true"><svg class="i i-copy" aria-hidden="true"><use href="#i-copy"/></svg><svg class="i i-check" aria-hidden="true"><use href="#i-check"/></svg></span><span class="swap"><span>Copy</span><span>Copied</span></span></button></div>
            </div>
          </div>
        </div>

        <div class="method" role="tabpanel" id="mp-mcp" aria-labelledby="mt-mcp" hidden>
          <div class="method__side">
            <div class="vtabs" role="tablist" aria-orientation="vertical" aria-label="MCP client" data-tabs="mcp">
              <button role="tab" id="ct-claude" aria-controls="cp-claude" aria-selected="true"><img src="/site/assets/logos/claudecode-color.svg" alt="" width="16" height="16"><span>Claude Code</span></button>
              <button role="tab" id="ct-codex" aria-controls="cp-codex" aria-selected="false" tabindex="-1"><img src="/site/assets/logos/codex-color.svg" alt="" width="16" height="16"><span>Codex</span></button>
              <button role="tab" id="ct-cursor" aria-controls="cp-cursor" aria-selected="false" tabindex="-1"><img src="/site/assets/logos/cursor.svg" alt="" width="16" height="16"><span>Cursor</span></button>
              <button role="tab" id="ct-chatgpt" aria-controls="cp-chatgpt" aria-selected="false" tabindex="-1"><img src="/site/assets/logos/openai.svg" alt="" width="16" height="16"><span>ChatGPT</span></button>
              <button role="tab" id="ct-claudeai" aria-controls="cp-claudeai" aria-selected="false" tabindex="-1"><img src="/site/assets/logos/claude-color.svg" alt="" width="16" height="16"><span>Claude</span></button>
              <button role="tab" id="ct-other" aria-controls="cp-other" aria-selected="false" tabindex="-1"><img src="/site/assets/logos/mcp.svg" alt="" width="16" height="16"><span>Other clients</span></button>
            </div>
          </div>
          <div class="tab-panels method__main">
            <div class="ipanel" role="tabpanel" id="cp-claude" aria-labelledby="ct-claude">
              <p class="ipanel__how">Run this in your project.</p>
              <div class="codeblock"><pre>claude mcp add --transport http classifier https://classifier.dev/mcp</pre><button class="copy" aria-label="Copy command"><span class="swap-ico" aria-hidden="true"><svg class="i i-copy" aria-hidden="true"><use href="#i-copy"/></svg><svg class="i i-check" aria-hidden="true"><use href="#i-check"/></svg></span><span class="swap"><span>Copy</span><span>Copied</span></span></button></div>
            </div>
            <div class="ipanel" role="tabpanel" id="cp-codex" aria-labelledby="ct-codex" hidden>
              <p class="ipanel__how">Run this once.</p>
              <div class="codeblock"><pre>codex mcp add classifier --url https://classifier.dev/mcp</pre><button class="copy" aria-label="Copy command"><span class="swap-ico" aria-hidden="true"><svg class="i i-copy" aria-hidden="true"><use href="#i-copy"/></svg><svg class="i i-check" aria-hidden="true"><use href="#i-check"/></svg></span><span class="swap"><span>Copy</span><span>Copied</span></span></button></div>
            </div>
            <div class="ipanel" role="tabpanel" id="cp-cursor" aria-labelledby="ct-cursor" hidden>
              <p class="ipanel__how">Add it in Settings &gt; MCP &gt; Add new global MCP server, or put this in .cursor/mcp.json.</p>
              <div class="codeblock"><pre>{"mcpServers": {"classifier": {"url": "https://classifier.dev/mcp"}}}</pre><button class="copy" aria-label="Copy configuration"><span class="swap-ico" aria-hidden="true"><svg class="i i-copy" aria-hidden="true"><use href="#i-copy"/></svg><svg class="i i-check" aria-hidden="true"><use href="#i-check"/></svg></span><span class="swap"><span>Copy</span><span>Copied</span></span></button></div>
            </div>
            <div class="ipanel" role="tabpanel" id="cp-chatgpt" aria-labelledby="ct-chatgpt" hidden>
              <p class="ipanel__how">Turn on Settings &gt; Security and login &gt; Developer mode. Then create an app under Settings &gt; Apps &amp; Connectors with this URL and No Authentication.</p>
              <div class="codeblock"><pre>https://classifier.dev/mcp</pre><button class="copy" aria-label="Copy URL"><span class="swap-ico" aria-hidden="true"><svg class="i i-copy" aria-hidden="true"><use href="#i-copy"/></svg><svg class="i i-check" aria-hidden="true"><use href="#i-check"/></svg></span><span class="swap"><span>Copy</span><span>Copied</span></span></button></div>
            </div>
            <div class="ipanel" role="tabpanel" id="cp-claudeai" aria-labelledby="ct-claudeai" hidden>
              <p class="ipanel__how">Go to Customize &gt; Connectors &gt; Add custom connector, and paste this URL.</p>
              <div class="codeblock"><pre>https://classifier.dev/mcp</pre><button class="copy" aria-label="Copy URL"><span class="swap-ico" aria-hidden="true"><svg class="i i-copy" aria-hidden="true"><use href="#i-copy"/></svg><svg class="i i-check" aria-hidden="true"><use href="#i-check"/></svg></span><span class="swap"><span>Copy</span><span>Copied</span></span></button></div>
            </div>
            <div class="ipanel" role="tabpanel" id="cp-other" aria-labelledby="ct-other" hidden>
              <p class="ipanel__how">For VS Code, Windsurf, Gemini CLI, Grok Build, Zed and others, this finds your clients and writes their config.</p>
              <div class="codeblock"><pre>npx add-mcp@2.4.1 https://classifier.dev/mcp --name classifier</pre><button class="copy" aria-label="Copy command"><span class="swap-ico" aria-hidden="true"><svg class="i i-copy" aria-hidden="true"><use href="#i-copy"/></svg><svg class="i i-check" aria-hidden="true"><use href="#i-check"/></svg></span><span class="swap"><span>Copy</span><span>Copied</span></span></button></div>
            </div>
          </div>
        </div>

        <div class="method" role="tabpanel" id="mp-cli" aria-labelledby="mt-cli" hidden>
          <div class="method__side">
            <p class="method__lead">Classify files from your shell. Install it, then pipe in a file with one item per line. Add --no-share-data to keep your text out of training.</p>
          </div>
          <div class="method__main">
            <div class="ipanel">
              <div class="codeblock"><pre>npm i -g classifier-dev
classify bug,feature,praise --no-share-data &lt; feedback.txt</pre><button class="copy" aria-label="Copy commands"><span class="swap-ico" aria-hidden="true"><svg class="i i-copy" aria-hidden="true"><use href="#i-copy"/></svg><svg class="i i-check" aria-hidden="true"><use href="#i-check"/></svg></span><span class="swap"><span>Copy</span><span>Copied</span></span></button></div>
            </div>
          </div>
        </div>

        <div class="method" role="tabpanel" id="mp-api" aria-labelledby="mt-api" hidden>
          <div class="method__side">
            <div class="vtabs" role="tablist" aria-orientation="vertical" aria-label="Coding agent" data-tabs="api">
              <button role="tab" id="at-claude" aria-controls="ap-claude" aria-selected="true"><img src="/site/assets/logos/claudecode-color.svg" alt="" width="16" height="16"><span>Claude Code</span></button>
              <button role="tab" id="at-codex" aria-controls="ap-codex" aria-selected="false" tabindex="-1"><img src="/site/assets/logos/codex-color.svg" alt="" width="16" height="16"><span>Codex</span></button>
              <button role="tab" id="at-cursor" aria-controls="ap-cursor" aria-selected="false" tabindex="-1"><img src="/site/assets/logos/cursor.svg" alt="" width="16" height="16"><span>Cursor</span></button>
              <button role="tab" id="at-grok" aria-controls="ap-grok" aria-selected="false" tabindex="-1"><img src="/site/assets/logos/grok.svg" alt="" width="16" height="16"><span>Grok</span></button>
              <button role="tab" id="at-any" aria-controls="ap-any" aria-selected="false" tabindex="-1"><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M4.5 6l2 2-2 2M8 10.5h3.5" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Any other agent</span></button>
            </div>
          </div>
          <div class="tab-panels method__main">
            <div class="ipanel" role="tabpanel" id="ap-claude" aria-labelledby="at-claude">
              <p class="ipanel__how">Paste this into Claude Code, or open it there with the prompt filled in.</p>
              <div class="codeblock"><pre data-prompt="api"></pre><button class="copy" aria-label="Copy prompt"><span class="swap-ico" aria-hidden="true"><svg class="i i-copy" aria-hidden="true"><use href="#i-copy"/></svg><svg class="i i-check" aria-hidden="true"><use href="#i-check"/></svg></span><span class="swap"><span>Copy</span><span>Copied</span></span></button></div>
              <a class="btn btn--soft btn--sm" data-deeplink="claude" data-prompt-kind="api"><img src="/site/assets/logos/claudecode-color.svg" alt="" width="14" height="14">Open in Claude Code</a>
            </div>
            <div class="ipanel" role="tabpanel" id="ap-codex" aria-labelledby="at-codex" hidden>
              <p class="ipanel__how">Paste this into Codex, or open it there with the prompt filled in.</p>
              <div class="codeblock"><pre data-prompt="api"></pre><button class="copy" aria-label="Copy prompt"><span class="swap-ico" aria-hidden="true"><svg class="i i-copy" aria-hidden="true"><use href="#i-copy"/></svg><svg class="i i-check" aria-hidden="true"><use href="#i-check"/></svg></span><span class="swap"><span>Copy</span><span>Copied</span></span></button></div>
              <a class="btn btn--soft btn--sm" data-deeplink="codex" data-prompt-kind="api"><img src="/site/assets/logos/codex-color.svg" alt="" width="14" height="14">Open in Codex</a>
            </div>
            <div class="ipanel" role="tabpanel" id="ap-cursor" aria-labelledby="at-cursor" hidden>
              <p class="ipanel__how">Paste this into Cursor, or open it there with the prompt filled in.</p>
              <div class="codeblock"><pre data-prompt="api"></pre><button class="copy" aria-label="Copy prompt"><span class="swap-ico" aria-hidden="true"><svg class="i i-copy" aria-hidden="true"><use href="#i-copy"/></svg><svg class="i i-check" aria-hidden="true"><use href="#i-check"/></svg></span><span class="swap"><span>Copy</span><span>Copied</span></span></button></div>
              <a class="btn btn--soft btn--sm" data-deeplink="cursor" data-prompt-kind="api"><img src="/site/assets/logos/cursor.svg" alt="" width="14" height="14">Open in Cursor</a>
            </div>
            <div class="ipanel" role="tabpanel" id="ap-grok" aria-labelledby="at-grok" hidden>
              <p class="ipanel__how">Paste this into Grok, or open it there with the prompt filled in.</p>
              <div class="codeblock"><pre data-prompt="api"></pre><button class="copy" aria-label="Copy prompt"><span class="swap-ico" aria-hidden="true"><svg class="i i-copy" aria-hidden="true"><use href="#i-copy"/></svg><svg class="i i-check" aria-hidden="true"><use href="#i-check"/></svg></span><span class="swap"><span>Copy</span><span>Copied</span></span></button></div>
              <a class="btn btn--soft btn--sm" data-deeplink="grok" data-prompt-kind="api"><img src="/site/assets/logos/grok.svg" alt="" width="14" height="14">Open in Grok</a>
            </div>
            <div class="ipanel" role="tabpanel" id="ap-any" aria-labelledby="at-any" hidden>
              <p class="ipanel__how">Paste this into any agent that can edit your code.</p>
              <div class="codeblock"><pre data-prompt="api"></pre><button class="copy" aria-label="Copy prompt"><span class="swap-ico" aria-hidden="true"><svg class="i i-copy" aria-hidden="true"><use href="#i-copy"/></svg><svg class="i i-check" aria-hidden="true"><use href="#i-check"/></svg></span><span class="swap"><span>Copy</span><span>Copied</span></span></button></div>
            </div>
          </div>
        </div>

      </div>
    </div>

    <div class="band" aria-hidden="true"></div>
    <div class="api" data-rise>
      <div class="api__side">
        <span class="side-ico"><svg class="i" aria-hidden="true"><use href="#i-braces"/></svg></span>
        <h3 class="cell__title">Call the API yourself</h3>
        <p class="cell__body">Plain HTTP. No key for free use, and up to <data value="max.inputs">1,000</data> inputs per request. Add share_data: false to keep your text out of training.</p>
        <a class="btn btn--sm btn--tint" href="/developers"><svg class="i" aria-hidden="true"><use href="#i-book-open"/></svg>API reference<svg class="i i-go" aria-hidden="true"><use href="#i-arrow-right"/></svg></a>
      </div>
      <div class="api__main">
      <div class="code-win">
        <div class="code-win__bar">
          <div class="tabs tabs--code" role="tablist" aria-label="Language" data-tabs="lang">
            <button role="tab" id="lt-curl" aria-controls="lp-curl" aria-selected="true"><svg class="i" aria-hidden="true"><use href="#i-terminal"/></svg>curl</button>
            <button role="tab" id="lt-js" aria-controls="lp-js" aria-selected="false" tabindex="-1"><svg class="i" aria-hidden="true"><use href="#si-javascript"/></svg>JavaScript</button>
            <button role="tab" id="lt-py" aria-controls="lp-py" aria-selected="false" tabindex="-1"><svg class="i" aria-hidden="true"><use href="#si-python"/></svg>Python</button>
            <span class="tabs__glider" aria-hidden="true"></span>
          </div>
          <button class="copy copy--code" data-copy-active="lang" aria-label="Copy code"><span class="swap-ico" aria-hidden="true"><svg class="i i-copy" aria-hidden="true"><use href="#i-copy"/></svg><svg class="i i-check" aria-hidden="true"><use href="#i-check"/></svg></span><span class="swap"><span>Copy</span><span>Copied</span></span></button>
        </div>
        <div class="code-win__body">
          <div class="tab-panels code-win__panels">
            <pre role="tabpanel" tabindex="0" id="lp-curl" aria-labelledby="lt-curl">curl classifier.dev -d '{
  "inputs": [
    "We were billed twice this month",
    "Export crashes on large files"
  ],
  "labels": ["bug", "feature", "billing"],
  "share_data": false
}'</pre>
            <pre role="tabpanel" tabindex="0" id="lp-js" aria-labelledby="lt-js" hidden>const res = await fetch("https://classifier.dev", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    inputs: ["We were billed twice this month",
             "Export crashes on large files"],
    labels: ["bug", "feature", "billing"],
    share_data: false,
  }),
});
const { results } = await res.json();</pre>
            <pre role="tabpanel" tabindex="0" id="lp-py" aria-labelledby="lt-py" hidden>import requests

res = requests.post("https://classifier.dev", json={
    "inputs": ["We were billed twice this month",
               "Export crashes on large files"],
    "labels": ["bug", "feature", "billing"],
    "share_data": False,
})
print(res.json()["results"])</pre>
          </div>
          <div class="code-win__res"><p class="code-win__cap"><span>Response</span><b><i></i>200 OK</b></p><pre class="code-win__out" aria-label="Response">{
  "tier": "fast",
  "model": "jev-1.13.0",
  "results": [
    {"label": "billing",
     "confidence": 1},
    {"label": "bug",
     "confidence": 1}
  ]
}</pre></div>
        </div>
      </div>
      </div>
    </div>
  </div>
</section>

<div class="gap" aria-hidden="true"><div class="rail"></div></div>

<!-- PRICING -->
<section class="sec" id="pricing" aria-labelledby="pricing-title">
  <div class="rail">
    <div class="sec-head">
      <div class="sec-head__copy">
        <h2 class="t-title" id="pricing-title" data-words>Pricing</h2>
        <p class="t-body">Free without an account. Plans add included usage, seats and higher rate limits for a workspace.</p>
      </div>
      <a class="btn btn--soft btn--sm" href="/pricing"><svg class="i" aria-hidden="true"><use href="#i-tag"/></svg>Full pricing</a>
    </div>
    <div class="cells cells--4 plans">
      <div class="cell plan" data-rise>
        <div class="plan__head"><h3 class="cell__title plan__name">Free</h3><p class="cell__body">For trying the API and shipping a first integration</p></div>
        <p class="plan__price"><span class="t-figure"><data value="plan.free.price">$0</data></span><span>always free</span></p>
        <a class="btn btn--soft plan__btn" href="/auth/sign-up">Start for free</a>
        <ul class="plan__list"><li><svg class="i" aria-hidden="true"><use href="#i-coins"/></svg><span><data value="plan.free.credit">$5</data> credit, once at personal signup</span></li><li><svg class="i" aria-hidden="true"><use href="#i-user"/></svg><span><data value="plan.free.seats">1</data> workspace seat</span></li><li><svg class="i" aria-hidden="true"><use href="#i-globe"/></svg>Public access without an account</li><li><svg class="i" aria-hidden="true"><use href="#i-zap"/></svg>Fast and Smart classification</li></ul>
      </div>
      <div class="cell plan plan--pick" data-rise>
        <div class="plan__head"><h3 class="cell__title plan__name">Pro</h3><p class="cell__body">For developers and personal agents in production</p></div>
        <p class="plan__price"><span class="t-figure"><data value="plan.pro.price">$20</data></span><span>per month</span></p>
        <a class="btn btn--accent plan__btn" href="/auth/sign-up?returnTo=/app/plans">Choose Pro</a>
        <ul class="plan__list"><li><svg class="i" aria-hidden="true"><use href="#i-wallet"/></svg><span><data value="plan.pro.included">$20</data> of usage each month</span></li><li><svg class="i" aria-hidden="true"><use href="#i-users"/></svg><span><data value="plan.pro.seats">3</data> workspace seats</span></li><li><svg class="i" aria-hidden="true"><use href="#i-gauge"/></svg><span><data value="plan.pro.rate">10×</data> rate limits</span></li><li><svg class="i" aria-hidden="true"><use href="#i-chart-column"/></svg>Usage by connection and agent</li></ul>
      </div>
      <div class="cell plan" data-rise>
        <div class="plan__head"><h3 class="cell__title plan__name">Scale</h3><p class="cell__body">For teams running classification in production</p></div>
        <p class="plan__price"><span class="t-figure"><data value="plan.scale.price">$200</data></span><span>per month</span></p>
        <a class="btn btn--soft plan__btn" href="/auth/sign-up?returnTo=/app/plans">Choose Scale</a>
        <ul class="plan__list"><li><svg class="i" aria-hidden="true"><use href="#i-wallet"/></svg><span><data value="plan.scale.included">$200</data> of usage each month</span></li><li><svg class="i" aria-hidden="true"><use href="#i-infinity"/></svg>Unlimited workspace seats</li><li><svg class="i" aria-hidden="true"><use href="#i-gauge"/></svg><span><data value="plan.scale.rate">100×</data> rate limits</span></li><li><svg class="i" aria-hidden="true"><use href="#i-chart-column"/></svg>Usage by connection and agent</li></ul>
      </div>
      <div class="cell plan" data-rise>
        <div class="plan__head"><h3 class="cell__title plan__name">Enterprise</h3><p class="cell__body">For capacity, infrastructure or a contract</p></div>
        <p class="plan__price"><span class="t-figure">Custom</span></p>
        <a class="btn btn--soft plan__btn" href="mailto:contact@classifier.dev">Contact sales</a>
        <ul class="plan__list"><li><svg class="i" aria-hidden="true"><use href="#i-server"/></svg>Volume-based capacity</li><li><svg class="i" aria-hidden="true"><use href="#i-box"/></svg>Dedicated deployment</li><li><svg class="i" aria-hidden="true"><use href="#i-lock"/></svg>Private inference options</li><li><svg class="i" aria-hidden="true"><use href="#i-target"/></svg>Accuracy measured on your data</li></ul>
      </div>
    </div>
    <div class="band" aria-hidden="true"></div>
    <div class="usage" data-rise>
      <div class="usage__side">
        <span class="side-ico"><svg class="i" aria-hidden="true"><use href="#i-gauge"/></svg></span>
        <h3 class="cell__title">Usage</h3>
        <p class="cell__body">The same rates on every plan. Included usage is spent first, then top-ups, which never expire.</p>
        <p class="usage__foot">Output tokens are free. Top-ups go from <data value="topup.min">$5</data> to <data value="topup.max">$1,000</data>.</p>
      </div>
      <div class="cells rates">
        <div class="cell rate"><p class="rate__fig"><data value="rate.input">$0.042</data></p><p class="rate__tag">per million input tokens</p></div>
        <div class="cell rate"><p class="rate__fig"><data value="rate.smart">$2</data></p><p class="rate__tag">per 1,000 Smart mode reviews</p></div>
        <div class="cell rate"><p class="rate__fig"><data value="rate.long">$0.084</data></p><p class="rate__tag">per million tokens in long documents</p></div>
        <div class="cell rate"><p class="rate__fig"><data value="rate.web">$2.20</data></p><p class="rate__tag">per 1,000 web pages, plus classification</p></div>
      </div>
    </div>
  </div>
</section>

<div class="gap" aria-hidden="true"><div class="rail"></div></div>

<!-- FAQ -->
<section class="sec field" id="faq" aria-labelledby="faq-title" data-field="accent" data-scheme="light">
  <div class="rail faq">
    <div class="faq__side">
      <h2 class="t-title" id="faq-title" data-words>FAQ</h2>
      <p class="t-body">Something else? Email <a class="inline" href="mailto:contact@classifier.dev">contact@classifier.dev</a> or <a class="inline" href="https://cal.com/michaelsf/coffee">book a call</a>.</p>
    </div>
    <div class="faq__list" data-rise>
      <div class="qa is-open"><h3><button class="qa__q" aria-expanded="true" aria-controls="qa1" id="qq1"><span>Do I need an API key?</span><i class="qa__icon" aria-hidden="true"></i></button></h3>
        <div class="qa__a" id="qa1" role="region" aria-labelledby="qq1"><div><p>No. Free use works without a key or an account and is limited per IP: <data value="free.fast.rpm">3,000</data> classifications a minute and <data value="free.fast.daily">20,000</data> a day in Fast mode (<data value="free.smart.rpm">200</data> and <data value="free.smart.daily">2,000</data> in Smart), or twice that if you share your requests for training. Create a workspace when you want shared usage, billing and API keys for your team or agents.</p></div></div></div>
      <div class="qa"><h3><button class="qa__q" aria-expanded="false" aria-controls="qa2" id="qq2"><span>What happens to the text I send?</span><i class="qa__icon" aria-hidden="true"></i></button></h3>
        <div class="qa__a" id="qa2" role="region" aria-labelledby="qq2"><div><p>By default, request text, labels, instructions and results are kept for model training and operator review until they're deleted. Send share_data: false with each request to opt out; the playground on this page always does. Image and Jev-Omni requests are never kept for training, and caller IPs are never stored.</p></div></div></div>
      <div class="qa"><h3><button class="qa__q" aria-expanded="false" aria-controls="qa3" id="qq3"><span>Can it come up with the labels for me?</span><i class="qa__icon" aria-hidden="true"></i></button></h3>
        <div class="qa__a" id="qa3" role="region" aria-labelledby="qq3"><div><p>No. You always supply the labels; it picks the best fit and says how sure it is. Finding categories you haven't named is clustering, a different job. Add "none of these" when some items might fit nothing.</p></div></div></div>
      <div class="qa"><h3><button class="qa__q" aria-expanded="false" aria-controls="qa4" id="qq4"><span>What's the difference between Fast and Smart?</span><i class="qa__icon" aria-hidden="true"></i></button></h3>
        <div class="qa__a" id="qa4" role="region" aria-labelledby="qq4"><div><p>Fast answers every item with the decision model in one round trip. Smart does the same, then re-asks a reasoning model about every answer under <data value="smart.below">70%</data> confidence and replaces it. You pay the Smart charge only for answers it actually reviews.</p></div></div></div>
      <div class="qa"><h3><button class="qa__q" aria-expanded="false" aria-controls="qa5" id="qq5"><span>How is this different from prompting an LLM?</span><i class="qa__icon" aria-hidden="true"></i></button></h3>
        <div class="qa__a" id="qa5" role="region" aria-labelledby="qq5"><div><p>It's a decision model, not a chatbot: it returns a calibrated probability for every label instead of generated text. On AG News it matches a reasoning model's accuracy at about 2 ms an item instead of 3.4 seconds, and your agent never has to read the inputs into its context.</p></div></div></div>
      <div class="qa"><h3><button class="qa__q" aria-expanded="false" aria-controls="qa6" id="qq6"><span>How many items can I send at once?</span><i class="qa__icon" aria-hidden="true"></i></button></h3>
        <div class="qa__a" id="qa6" role="region" aria-labelledby="qq6"><div><p>Up to <data value="max.inputs">1,000</data> inputs per request, which come back in about 1.5 seconds. The CLI batches bigger files for you, four requests at a time.</p></div></div></div>
      <div class="qa"><h3><button class="qa__q" aria-expanded="false" aria-controls="qa7" id="qq7"><span>Does the TypeSafe SDK work with it?</span><i class="qa__icon" aria-hidden="true"></i></button></h3>
        <div class="qa__a" id="qa7" role="region" aria-labelledby="qq7"><div><p>Yes. classifier.dev implements TypeSafe's System One wire contract at the same paths, so the official JavaScript and Python SDKs work when you point their base URL at https://classifier.dev.</p></div></div></div>
    </div>
  </div>
</section>

<div class="gap" aria-hidden="true"><div class="rail"></div></div>

<!-- CLOSE -->
<section class="sec close" aria-labelledby="close-title">
  <div class="rail">
    <div class="close__head">
      <h2 class="t-title" id="close-title" data-words>Start classifying</h2>
      <p class="t-body close__sub">Free for agents, with no key or account.</p>
    </div>
    <div class="close__ctas">
      <div class="split-btn split-btn--ink" data-split>
        <button type="button" class="split-btn__main" data-copy-prompt>
          <span class="swap-ico swap-ico--agents" aria-hidden="true"><span class="agents i-copy"><i><img src="/site/assets/logos/claude-color.svg" alt="" width="12" height="12"></i><i><img src="/site/assets/logos/codex-color.svg" alt="" width="12" height="12"></i><i><img src="/site/assets/logos/cursor.svg" alt="" width="12" height="12"></i><i><img src="/site/assets/logos/grok.svg" alt="" width="12" height="12"></i><i><svg class="i" aria-hidden="true"><use href="#si-googlegemini"/></svg></i></span><span class="agents__ok i-check"><svg class="i"><use href="#i-check"/></svg></span></span>
          <span class="swap"><span>Copy setup prompt</span><span>Copied</span></span>
        </button>
        <div class="menu-pop" role="group" aria-label="Open the setup prompt in" hidden>
          <p class="menu-pop__label" aria-hidden="true">Open with the prompt in</p>
          <a class="menu-pop__item" data-deeplink="claude"><img src="/site/assets/logos/claudecode-color.svg" alt="" width="16" height="16"><span>Claude Code</span><svg class="ext" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M8.5 2.5h3v3M11.5 2.5l-5 5M10.5 8.5V11a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1H6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg></a>
          <a class="menu-pop__item" data-deeplink="codex"><img src="/site/assets/logos/codex-color.svg" alt="" width="16" height="16"><span>Codex</span><svg class="ext" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M8.5 2.5h3v3M11.5 2.5l-5 5M10.5 8.5V11a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1H6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg></a>
          <a class="menu-pop__item" data-deeplink="cursor"><img src="/site/assets/logos/cursor.svg" alt="" width="16" height="16"><span>Cursor</span><svg class="ext" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M8.5 2.5h3v3M11.5 2.5l-5 5M10.5 8.5V11a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1H6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg></a>
          <a class="menu-pop__item" data-deeplink="grok"><img src="/site/assets/logos/grok.svg" alt="" width="16" height="16"><span>Grok</span><svg class="ext" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M8.5 2.5h3v3M11.5 2.5l-5 5M10.5 8.5V11a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1H6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg></a>
        <button type="button" class="menu-pop__item menu-pop__more" data-install><span>More ways to install</span></button>
</div>
        <button type="button" class="split-btn__more" aria-haspopup="menu" aria-expanded="false" aria-label="Open in your agent, or other ways to install">
          <svg class="chev" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
        <a class="btn btn--soft" href="/auth/sign-up">Start for free</a>
    </div>
  </div>
</section>

</main>

<footer class="foot">
  <div class="rail">
    <div class="cells foot__updates" id="updates">
      <div class="cell upd2">
        <p class="upd2__say">Get an email when something new ships.</p>
        <form class="upd" method="post" action="/subscribe" data-subscribe>
          <div class="upd2__field">
            <input class="upd__email" type="email" name="email" required autocomplete="email" spellcheck="false" placeholder="you@example.com" aria-label="Your email address">
            <button type="submit" class="upd2__go" aria-label="Subscribe"><span>Subscribe</span><svg class="i" aria-hidden="true"><use href="#i-arrow-right"/></svg></button>
          </div>
          <p class="upd__said" role="alert" data-say></p>
        </form>
      </div>
    </div>
    <div class="cells foot__cells">
      <div class="cell foot__brand">
        <a class="brand" href="#top" aria-label="classifier.dev home"><svg class="lk" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg" viewBox="0 -874.7 7380.6 1089.8" fill="currentColor"><g transform="translate(-272.71 -957.09) scale(13.394)"><path fill-rule="evenodd" d="M32.21 20.36L32.20 20.36L32.19 20.36L32.18 20.36L32.18 20.37L32.18 20.38L32.28 21.27L32.30 22.19L32.29 23.14L32.26 24.11L32.22 25.08L32.17 26.05L32.12 27.03L32.06 28.01L32.01 28.98L31.96 29.96L31.93 30.92L31.91 31.88L31.90 32.83L31.92 33.76L31.96 34.68L31.96 34.69L32.02 35.59L32.12 36.48L32.25 37.35L32.41 38.20L32.61 39.02L32.85 39.82L32.86 39.82L33.14 40.59L33.14 40.60L33.48 41.34L33.86 42.06L34.30 42.74L34.79 43.39L34.80 43.39L35.35 44.01L35.95 44.59L35.96 44.59L36.63 45.13L37.36 45.63L37.36 45.64L38.16 46.10L39.03 46.53L39.96 46.91L40.97 47.25L42.05 47.55L43.20 47.80L43.74 47.89L43.74 49.01L42.97 48.75L42.96 48.75L41.83 48.43L40.74 48.19L39.69 48.02L38.68 47.92L37.72 47.89L36.79 47.92L35.91 48.02L35.90 48.02L35.06 48.19L34.25 48.41L33.47 48.70L32.73 49.04L32.02 49.44L31.35 49.89L30.70 50.39L30.08 50.94L29.49 51.53L28.93 52.16L28.39 52.83L28.39 52.84L27.87 53.54L27.86 53.54L27.36 54.28L26.88 55.05L26.41 55.85L25.96 56.67L25.52 57.51L25.09 58.36L24.66 59.23L24.25 60.11L23.84 61.00L23.42 61.89L23.01 62.77L22.60 63.66L22.18 64.54L21.76 65.40L21.32 66.24L20.86 67.05L20.36 67.79L20.36 67.80L20.36 67.81L20.36 67.82L20.37 67.82L20.38 67.82L21.27 67.72L22.19 67.70L23.14 67.71L24.11 67.74L25.08 67.78L26.05 67.83L27.03 67.88L28.01 67.94L28.98 67.99L29.96 68.04L30.92 68.07L31.88 68.09L32.83 68.10L33.76 68.08L34.68 68.04L34.69 68.04L35.59 67.98L36.48 67.88L37.35 67.75L38.20 67.59L39.02 67.39L39.82 67.15L39.82 67.14L40.59 66.86L40.60 66.86L41.34 66.52L42.06 66.14L42.74 65.70L43.39 65.21L43.39 65.20L43.76 64.87L43.77 64.87L43.77 64.86L43.77 62.51L49.99 62.51L50.01 62.51L56.24 62.51L56.24 68.74L49.99 68.74L49.99 75.01L56.24 75.01L56.26 75.01L62.49 75.01L62.49 81.26L68.76 81.26L68.76 75.01L68.76 74.99L68.76 68.74L62.51 68.74L62.51 62.51L62.51 62.49L62.51 56.26L62.51 56.24L62.51 50.01L68.76 50.01L68.76 43.76L75.01 43.76L75.01 37.51L75.01 37.49L75.01 31.24L68.76 31.24L68.74 31.24L62.51 31.24L62.49 31.24L56.24 31.24L56.24 37.49L50.01 37.49L50.01 31.26L50.01 31.24L50.01 24.99L43.74 24.99C40.2 23.9 36.2 21.6 32.21 20.36ZM56.26 49.99L56.24 49.99L50.01 49.99L50.01 43.76L56.26 43.76L56.26 37.51L62.49 37.51L62.51 37.51L68.74 37.51L68.74 43.74L62.49 43.74L62.49 49.99Z"/><path class="pol" style="--dx:0.0px;--dy:-12.5px;--i:0" d="M68.76 18.74L62.49 18.74L62.49 25.01L68.76 25.01Z"/><path class="pol" style="--dx:6.25px;--dy:-12.5px;--i:1" d="M87.49 31.24L87.49 37.51L93.76 37.51L93.76 31.24Z"/><path class="pol" style="--dx:6.25px;--dy:-12.5px;--i:2" d="M87.51 43.74L81.24 43.74L81.24 50.01L87.51 50.01Z"/><path class="pol" style="--dx:6.25px;--dy:-6.25px;--i:3" d="M74.99 56.24L74.99 62.51L81.26 62.51L81.26 56.24Z"/><path class="pol" style="--dx:6.25px;--dy:-12.5px;--i:4" d="M74.99 81.24L74.99 87.51L81.26 87.51L81.26 81.24Z"/></g><g transform="translate(1243.7 0) scale(0.86)"><path d="M544.9 -132.8Q466.3 20 311 20Q226.1 20 161.1 -24.9Q45.9 -104 45.9 -271Q45.9 -381.3 101.1 -456.1Q150.9 -523.9 233.9 -548.3Q274.9 -560.1 317.9 -560.1Q406.7 -560.1 463.9 -514.6Q515.1 -474.6 515.1 -428.2Q515.1 -411.1 508.3 -396Q493.7 -365.2 459 -365.2Q430.2 -365.2 415 -387.2Q405.8 -399.9 405.8 -417.5Q405.8 -452.6 429.7 -464.8Q398.9 -512.2 318.8 -512.2Q230 -512.2 174.3 -437.5Q126 -372.1 126 -271Q126 -197.3 152.8 -142.6Q177.2 -92.3 220.7 -64Q264.2 -36.1 317.9 -36.1Q438 -36.1 513.7 -165ZM644 0V-36.1Q704.6 -38.6 721.7 -56.6Q736.8 -72.8 736.8 -116.2V-653.3Q736.8 -696.3 717.8 -710Q701.2 -722.2 647 -724.1V-760.3Q735.8 -760.7 807.6 -780.3V-116.2Q807.6 -68.8 825.7 -53.2Q841.8 -39.1 899.4 -36.1V0ZM1381.3 -351.1V-366.2Q1381.3 -437.5 1350.1 -470.7Q1333.9 -487.8 1304.6 -499.5Q1270 -513.2 1232.9 -513.2Q1173.3 -513.2 1134.7 -494.1Q1115.2 -484.9 1109.3 -473.1Q1137.2 -462.4 1137.2 -424.8Q1137.2 -406.7 1127.4 -393.1Q1112.3 -372.1 1083.9 -372.1Q1061.5 -372.1 1046.3 -389.2Q1030.2 -407.7 1030.2 -436.5Q1030.2 -483.9 1085.9 -519.5Q1148.4 -560.1 1235.8 -560.1Q1322.2 -560.1 1380.3 -522.5Q1450.2 -477.1 1450.2 -345.2V-120.1Q1450.2 -50.8 1481.4 -50.8Q1509.2 -50.8 1533.2 -101.1L1562 -64Q1527.3 18.1 1467.2 18.1Q1388.6 18.1 1382.3 -86.9Q1321.2 18.1 1171.3 18.1Q1085.9 18.1 1037.6 -43Q1004.4 -85.4 1004.4 -144Q1004.4 -237.3 1097.6 -290Q1187.9 -341.8 1339.3 -349.1ZM1381.3 -300.8 1344.2 -298.8Q1216.3 -292 1147.4 -253.9Q1081.5 -217.8 1081.5 -147.9Q1081.5 -102.5 1105.9 -75.7Q1134.2 -43.9 1190.4 -43.9Q1245.6 -43.9 1296.3 -70.3Q1350.1 -98.1 1371.5 -139.6Q1381.3 -159.2 1381.3 -178.2ZM1644.5 -195.8H1678.7Q1700.6 -107.9 1757.3 -68.4Q1816.3 -26.9 1879.3 -26.9Q1938.4 -26.9 1975.5 -55.7Q2011.2 -83 2011.2 -123Q2011.2 -166.5 1961.9 -197.8Q1932.1 -216.8 1875.4 -236.8L1847.6 -247.1Q1726 -290 1690.4 -325.7Q1655.2 -360.8 1655.2 -418.5Q1655.2 -480.5 1706.5 -521.5Q1754.3 -560.1 1839.3 -560.1Q1910.6 -560.1 1971.1 -515.1Q1981.9 -506.8 1993.1 -506.8Q2006.8 -506.8 2011.2 -540H2044.4V-377H2006.3Q1989.7 -436 1951.1 -472.2Q1907.2 -513.2 1841.2 -513.2Q1788 -513.2 1758.7 -490.7Q1726.5 -465.8 1726.5 -424.3Q1726.5 -394.5 1754.8 -372.1Q1779.7 -353 1864.2 -323.2L1898.4 -311Q2003.8 -273.9 2044.9 -235.8Q2088.3 -195.3 2088.3 -127.4Q2088.3 -58.6 2031.2 -19Q1975.5 20 1887.6 20Q1807.1 20 1744.6 -22L1742.1 -23.4Q1719.2 -39.1 1712.8 -39.1Q1696.2 -39.1 1678.7 14.2H1644.5ZM2204.5 -195.8H2238.7Q2260.7 -107.9 2317.3 -68.4Q2376.4 -26.9 2439.4 -26.9Q2498.5 -26.9 2535.6 -55.7Q2571.2 -83 2571.2 -123Q2571.2 -166.5 2521.9 -197.8Q2492.1 -216.8 2435.5 -236.8L2407.6 -247.1Q2286.1 -290 2250.4 -325.7Q2215.3 -360.8 2215.3 -418.5Q2215.3 -480.5 2266.5 -521.5Q2314.4 -560.1 2399.3 -560.1Q2470.6 -560.1 2531.2 -515.1Q2541.9 -506.8 2553.1 -506.8Q2566.8 -506.8 2571.2 -540H2604.4V-377H2566.3Q2549.7 -436 2511.2 -472.2Q2467.2 -513.2 2401.3 -513.2Q2348.1 -513.2 2318.8 -490.7Q2286.5 -465.8 2286.5 -424.3Q2286.5 -394.5 2314.9 -372.1Q2339.8 -353 2424.2 -323.2L2458.4 -311Q2563.9 -273.9 2604.9 -235.8Q2648.4 -195.3 2648.4 -127.4Q2648.4 -58.6 2591.2 -19Q2535.6 20 2447.7 20Q2367.1 20 2304.6 -22L2302.2 -23.4Q2279.2 -39.1 2272.9 -39.1Q2256.3 -39.1 2238.7 14.2H2204.5ZM2880.3 -807.1Q2897.4 -807.1 2913.5 -797.4Q2942.3 -778.8 2942.3 -745.1Q2942.3 -720.7 2925.2 -702.6Q2907.1 -683.1 2880.3 -683.1Q2864.6 -683.1 2851 -690.4Q2818.3 -708.5 2818.3 -745.1Q2818.3 -773.4 2839.7 -792Q2857.3 -807.1 2880.3 -807.1ZM2747.5 0V-36.1Q2814.8 -38.6 2831.9 -56.6Q2847.6 -72.8 2847.6 -116.2V-433.1Q2847.6 -473.1 2826.6 -486.3Q2806.5 -499 2757.2 -503.9V-540Q2830.5 -540 2918.4 -560.1V-116.2Q2918.4 -69.3 2936.9 -52.2Q2954 -37.1 3014.1 -36.1V0ZM3201.5 -540V-588.9Q3201.5 -684.1 3262.6 -737.3Q3319.2 -787.1 3413.5 -787.1Q3503.8 -787.1 3552.1 -746.1Q3583.9 -718.8 3583.9 -688.5Q3583.9 -672.9 3576.1 -660.2Q3561.9 -637.2 3533.6 -637.2Q3511.1 -637.2 3495 -651.9Q3480.8 -664.6 3480.8 -683.1Q3480.8 -707 3498.9 -716.3Q3470.6 -743.2 3413.9 -743.2Q3342.2 -743.2 3302.6 -690.9Q3271.4 -650.4 3271.4 -592.3V-540H3434Q3528.2 -540 3609.7 -560.1V-116.2Q3609.7 -69.3 3628.3 -52.2Q3645.4 -37.1 3705.9 -36.1V0H3438.8V-36.1Q3506.2 -38.6 3523.8 -56.6Q3538.9 -72.8 3538.9 -116.2V-418Q3538.9 -464.4 3504.8 -481Q3483.3 -492.2 3434 -492.2H3271.4V-116.2Q3271.4 -68.8 3288.9 -53.7Q3306 -39.1 3363.7 -36.1V0H3107.3V-36.1Q3166.9 -38.6 3184.5 -55.2Q3201.5 -70.8 3201.5 -116.2V-492.2H3092.7V-540ZM3885.6 -275.4V-267.6Q3885.6 -189 3916.9 -131.8Q3969.1 -36.1 4077.5 -36.1Q4197.6 -36.1 4277.7 -159.2L4309.4 -127.4Q4224.5 20 4071.2 20Q3936.4 20 3862.7 -81.1Q3807.5 -156.7 3807.5 -268.1Q3807.5 -382.8 3869 -463.4Q3943.7 -560.1 4065.8 -560.1Q4151.2 -560.1 4214.7 -511.7Q4286 -458 4307.5 -364.7Q4315.3 -331.1 4315.3 -295.4V-275.4ZM4231.3 -323.2Q4227.4 -406.2 4194.7 -449.2Q4146.3 -513.2 4066.8 -513.2Q3992.1 -513.2 3939.3 -449.2Q3897.3 -398.4 3887.6 -323.2ZM4415.4 0V-36.1Q4477.4 -37.6 4493.5 -55.7Q4508.1 -71.8 4508.1 -116.2V-433.1Q4508.1 -474.6 4490.1 -487.8Q4473.5 -500.5 4418.3 -503.9V-540Q4492.5 -540 4574.6 -560.1V-446.8Q4604.3 -495.1 4663.9 -530.8Q4712.2 -560.1 4767.4 -560.1Q4807 -560.1 4831.9 -540Q4860.2 -517.1 4860.2 -476.6Q4860.2 -452.6 4846 -437Q4830.4 -419.9 4804.5 -419.9Q4788.9 -419.9 4776.2 -428.2Q4750.8 -444.8 4750.8 -475.1Q4750.8 -490.7 4761.1 -505.9Q4716.2 -504.9 4672.2 -473.1Q4614.6 -431.6 4578 -367.2V-116.2Q4578 -69.3 4595.1 -54.2Q4613.6 -37.1 4677.1 -36.1V0ZM5029.1 -115.7Q5050.1 -115.7 5069.2 -104.5Q5106.8 -82 5106.8 -37.6Q5106.8 -8.3 5087.2 13.7Q5063.8 40 5028.1 40Q5010.1 40 4993.5 31.7Q4951 9.8 4951 -38.1Q4951 -71.3 4975.4 -94.7Q4997.9 -115.7 5029.1 -115.7ZM5694.1 0 5685.4 -50.8Q5629.2 20 5522.8 20Q5390.9 20 5323 -82Q5272.3 -158.7 5272.3 -277.3Q5272.3 -389.2 5333.8 -468.3Q5405.6 -560.1 5515.9 -560.1Q5584.3 -560.1 5639.5 -520.5Q5669.7 -499 5687.3 -466.8V-652.8Q5687.3 -698.2 5671.2 -709Q5654.6 -720.7 5596.5 -724.1V-760.3Q5681.9 -760.3 5757.1 -780.3V-105Q5757.1 -69.8 5775.7 -53.7Q5792.3 -38.6 5846 -36.1V0ZM5527.6 -503.9Q5462.2 -503.9 5411.4 -448.2Q5351.4 -382.3 5351.4 -277.3Q5351.4 -183.1 5389.9 -118.2Q5440.7 -33.2 5525.2 -33.2Q5591.6 -33.2 5635.1 -73.7Q5667.8 -105 5679 -160.2Q5688.3 -206.1 5688.3 -275.9Q5688.3 -390.6 5647.8 -441.9Q5598.9 -503.9 5527.6 -503.9ZM6015.4 -275.4V-267.6Q6015.4 -189 6046.7 -131.8Q6098.9 -36.1 6207.3 -36.1Q6327.4 -36.1 6407.5 -159.2L6439.2 -127.4Q6354.3 20 6201 20Q6066.2 20 5992.5 -81.1Q5937.3 -156.7 5937.3 -268.1Q5937.3 -382.8 5998.8 -463.4Q6073.5 -560.1 6195.6 -560.1Q6281 -560.1 6344.5 -511.7Q6415.8 -458 6437.3 -364.7Q6445.1 -331.1 6445.1 -295.4V-275.4ZM6361.1 -323.2Q6357.2 -406.2 6324.5 -449.2Q6276.2 -513.2 6196.6 -513.2Q6121.9 -513.2 6069.1 -449.2Q6027.1 -398.4 6017.4 -323.2ZM6532 -540H6766.9V-503.9Q6690.7 -501 6690.7 -477.1Q6690.7 -463.9 6700.9 -440.9L6853.8 -99.1L6986.1 -418Q6996.8 -444.3 6996.8 -465.3Q6996.8 -497.6 6911.9 -503.9V-540H7136V-503.9Q7098.9 -498.5 7076.9 -474.6Q7056.4 -452.6 7038.8 -411.1L6861.1 12.2H6824L6631.1 -428.2Q6614 -466.8 6589.1 -485.8Q6568.6 -502 6532 -503.9Z"/></g></svg></a>
        <p>Zero-shot classification over plain HTTP.</p>
        <span class="foot__icons">
          <a class="icon-link" href="https://x.com/michael_chomsky" aria-label="classifier.dev on X"><svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M18.9 2H22l-6.8 7.8L23 22h-6.2l-4.8-6.3L6.4 22H3.3l7.3-8.3L1 2h6.3l4.4 5.8L18.9 2zm-1.1 18h1.7L6.3 3.9H4.5L17.8 20z"/></svg></a>
          <a class="icon-link" href="https://github.com/mrmps/classifier-dev" aria-label="classifier.dev on GitHub"><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg></a>
        </span>
      </div>
      <nav class="cell foot__col" aria-label="Product"><h2>Product</h2><a href="/benchmark">Benchmark</a><a href="#pricing">Pricing</a><a href="/chat">Chat</a><a href="https://cal.com/michaelsf/coffee">Book a call</a></nav>
      <nav class="cell foot__col" aria-label="Developers"><h2>Developers</h2><a href="/developers">Docs</a><a href="/mcp-setup">MCP setup</a><a href="/openapi.json">OpenAPI</a><a href="/skill.md">Agent skill</a><a href="/llms.txt">llms.txt</a><a href="/index.md">Markdown</a><a href="/.well-known/agent-feedback.json">Agent feedback</a></nav>
      <nav class="cell foot__col" aria-label="Company"><h2>Company</h2><a href="/about">About</a><a href="/contact">Contact</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a></nav>
    </div>
    <div class="foot__base">
      <span>© 2026 classifier.dev. All rights reserved.</span>
    </div>
  </div>
</footer>

<dialog class="preview" id="preview" aria-labelledby="preview-name">
  <div class="preview__bar"><span class="preview__name" id="preview-name"></span><span class="preview__meta" id="preview-meta"></span><button type="button" class="x preview__x" data-close aria-label="Close preview"><svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg></button></div>
  <pre class="preview__body" id="preview-body" tabindex="0" data-lenis-prevent></pre>
</dialog>
<div class="fwin" id="fwin" role="dialog" aria-labelledby="fwin-name" hidden>
  <div class="fwin__bar"><span class="fwin__name" id="fwin-name"></span><span class="fwin__meta" id="fwin-meta"></span><button type="button" class="x fwin__x" aria-label="Close preview"><svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg></button></div>
  <div class="fwin__body" id="fwin-body" data-lenis-prevent></div>
  <div class="fwin__foot"><button type="button" class="btn btn--ink btn--sm" id="fwin-add">Add to box</button></div>
</div>
<dialog class="sheet" id="sheet" aria-labelledby="sheet-title">
  <div class="sheet__bar">
    <div class="sheet__head"><h2 class="sheet__title" id="sheet-title" tabindex="-1" autofocus></h2><p class="sheet__meta" id="sheet-meta"></p></div>
    <button type="button" class="btn btn--soft btn--sm" id="sheet-edit"><svg class="i" aria-hidden="true"><use href="#i-pencil"/></svg>Edit</button>
    <button type="button" class="btn btn--soft btn--sm" id="sheet-copy"><span class="swap-ico" aria-hidden="true"><svg class="i i-copy"><use href="#i-copy"/></svg><svg class="i i-check"><use href="#i-check"/></svg></span><span class="swap"><span>Copy API call</span><span>Copied</span></span></button>
    <button type="button" class="x sheet__x" data-close aria-label="Close"><svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg></button>
  </div>
  <div class="sheet__tabs" id="sheet-tabs" role="group" aria-label="Show"></div>
  <ol class="rows" id="sheet-rows" tabindex="0" aria-label="Items and their labels" data-lenis-prevent></ol>
</dialog>
<dialog class="install-pop" id="install-pop" aria-labelledby="install-pop-title">
  <div class="install-pop__bar"><div class="install-pop__head"><span class="install-pop__ok" aria-hidden="true"><svg width="12" height="12" viewBox="0 0 12 12"><path d="M2.5 6.2l2.3 2.3 4.7-5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span><h2 class="install-pop__title" id="install-pop-title" tabindex="-1">Install classifier.dev</h2><p class="install-pop__sub">Paste it into your agent and it sets itself up. Pick yours below, or connect another way.</p></div><button type="button" class="x" data-close aria-label="Close"><svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg></button></div>
  <div class="install-pop__body" data-lenis-prevent></div>
</dialog>
<section class="ctoast" id="ctoast" aria-labelledby="ctoast-title" hidden>
  <div class="ctoast__head"><span class="ctoast__ok" aria-hidden="true"><svg class="i"><use href="#i-check"/></svg></span><div><h2 class="ctoast__title" id="ctoast-title" tabindex="-1">Setup prompt copied</h2><p class="ctoast__sub">Paste it into your agent, or open it in one:</p></div><button type="button" class="x" data-ct-close aria-label="Close"><svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg></button></div>
  <div class="ctoast__agents"><a class="ctoast__agent" data-deeplink="claude"><img src="/site/assets/logos/claudecode-color.svg" alt="" width="20" height="20"><span>Claude Code</span><svg class="i ctoast__go" aria-hidden="true"><use href="#i-arrow-up-right"/></svg></a><a class="ctoast__agent" data-deeplink="codex"><img src="/site/assets/logos/codex-color.svg" alt="" width="20" height="20"><span>Codex</span><svg class="i ctoast__go" aria-hidden="true"><use href="#i-arrow-up-right"/></svg></a><a class="ctoast__agent" data-deeplink="cursor"><img src="/site/assets/logos/cursor.svg" alt="" width="20" height="20"><span>Cursor</span><svg class="i ctoast__go" aria-hidden="true"><use href="#i-arrow-up-right"/></svg></a><a class="ctoast__agent" data-deeplink="grok"><img src="/site/assets/logos/grok.svg" alt="" width="20" height="20"><span>Grok</span><svg class="i ctoast__go" aria-hidden="true"><use href="#i-arrow-up-right"/></svg></a></div>
  <button type="button" class="ctoast__more" aria-expanded="false" aria-controls="ctoast-more"><span>More options</span><svg class="i" aria-hidden="true"><use href="#i-chevron-down"/></svg></button>
  <div class="reveal ctoast__reveal" id="ctoast-more"><div class="ctoast__body" data-lenis-prevent></div></div>
  <span class="ctoast__timer" aria-hidden="true"></span>
</section>
<section class="ctoast utoast" id="utoast" aria-labelledby="utoast-title" hidden>
  <div class="ctoast__head"><span class="ctoast__ok" aria-hidden="true"><svg class="i"><use href="#i-check"/></svg></span><div><h2 class="ctoast__title" id="utoast-title" tabindex="-1">Check your inbox to confirm</h2><p class="ctoast__sub">Anything you want to hear about first? Optional.</p></div><button type="button" class="x" data-ut-close aria-label="Close"><svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg></button></div>
  <div class="utoast__pick" role="group" aria-label="What you would use first">
    <!--@roadmap-->
  </div>
  <div class="utoast__foot"><p>Your address and what you ticked are kept apart from API traffic.</p><button type="button" class="btn btn--ink btn--sm" data-ut-done>Done</button></div>
  <span class="ctoast__timer" aria-hidden="true"></span>
</section>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<p class="sr" id="sr-status" role="status" aria-live="polite"></p>
<p class="sr" id="sr-alert" role="alert"></p>

<script src="/site/vendor/gsap.min.js" defer></script>
<script src="/site/vendor/ScrollTrigger.min.js" defer></script>
<script src="/site/nav.js" defer></script>
<script src="/site/app.js" defer></script>
<script src="/site/motion.js" defer></script>
<script src="/site/uses.js" defer></script>
<script type="module" src="/site/signal.js"></script>
<!--chat-->
<button type="button" class="chat-fab" aria-expanded="false" aria-controls="chat" data-chat-open><svg class="i chat-fab__open" aria-hidden="true"><use href="#i-message-square"/></svg><svg class="chat-fab__close" width="14" height="14" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg><span class="sr">Chat</span></button>
<section class="chat" role="dialog" aria-modal="false" id="chat" aria-label="Chat" hidden>
  <header class="chat__head">
    <div><h2 class="chat__title" id="chat-title">Chat</h2><p class="chat__sub">Answers by calling the API</p></div>
    <button type="button" class="ghost-btn chat__clear" data-chat-clear hidden>Clear</button>
    <button type="button" class="x" data-chat-close aria-label="Close chat"><svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg></button>
  </header>
  <div class="chat__body" data-lenis-prevent>
    <div class="chat__empty">
      <div class="chat__sugs" role="group" aria-label="Try one"><button type="button" class="csug" data-ask="Read https://news.ycombinator.com, then classify every story title there into ai, security, business, hardware, other. Show the counts and the least confident three." title="Read https://news.ycombinator.com, then classify every story title there into ai, security, business, hardware, other. Show the counts and the least confident three.">Sort today’s Hacker News by topic</button><button type="button" class="csug" data-ask="Search for this week’s headlines about the Federal Reserve, classify each as hawkish, dovish or neutral, and tell me the split." title="Search for this week’s headlines about the Federal Reserve, classify each as hawkish, dovish or neutral, and tell me the split.">Is the Fed hawkish this week?</button><button type="button" class="csug" data-ask="Read the Rust changelog at https://github.com/rust-lang/rust/blob/master/RELEASES.md and tag the first 40 entries with every label that applies: language, compiler, library, tooling, platform." title="Read the Rust changelog at https://github.com/rust-lang/rust/blob/master/RELEASES.md and tag the first 40 entries with every label that applies: language, compiler, library, tooling, platform.">Tag the latest Rust release notes</button><button type="button" class="csug" data-ask="Invent 15 realistic customer support emails, sort them into billing, bug, feature, other, and show me which ones a human should double-check." title="Invent 15 realistic customer support emails, sort them into billing, bug, feature, other, and show me which ones a human should double-check.">Triage 15 made-up support emails</button></div>
    </div>
    <ol class="cmsgs" aria-live="polite" aria-label="Conversation"></ol>
  </div>
  <form class="chat__form" novalidate>
    <div class="chat__field">
      <textarea rows="1" placeholder="Ask, or paste texts to sort" aria-label="Message" required></textarea>
      <button type="submit" class="btn btn--ink btn--sm chat__send" aria-label="Send" disabled><svg class="i chat__go" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg><span class="chat__stop" aria-hidden="true"></span></button>
    </div>
    <p class="chat__note">Enter sends, Shift+Enter for a new line.</p>
  </form>
</section>
<!--/chat-->
<script src="/site/chat.js" defer></script>
<script src="/site/brand.js" defer></script>
</body>
</html>
`;
