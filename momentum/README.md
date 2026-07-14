# Momentum

A tiny phone-first habit app. Two habits only — **no nail-biting** and **workouts** — with a
streak-driven reward ladder aimed at one goal: **spot-free nails by Dec 31, 2026.**

It's a PWA: installs to your iPhone home screen, runs fullscreen, works offline, data stored
on the device (localStorage). No account, no backend.

## How the rewards stay financially safe
A reward unlocks only when **both** are true:
1. You've hit the **streak / workout count**.
2. The **Reward Fund** has the cash for it (and you're under your monthly cap).

You feed the fund from **money you didn't spend** — log how far you came in under your weekly
fun-money target. Rewards are paid for by avoided spending, so they never add to your costs and
your savings keep growing. The fund can't go negative.

## Ghost-host it on stoekmedia.com (GitHub Pages — same setup as your other sites)
The site is served from your `stoekmedia` GitHub repo. To put this app at
`https://stoekmedia.com/momentum/` without linking it from the main site:

1. Open your `stoekmedia` repo on github.com.
2. **Add file → Upload files**, then drag in this whole `momentum` folder
   (`index.html`, `manifest.webmanifest`, `sw.js`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`).
   Keep them inside a folder named `momentum`.
3. Commit. Wait ~1–2 min for Pages to rebuild.
4. Visit **https://stoekmedia.com/momentum/** on your phone.

Nothing links to it from your homepage, so it's effectively private (anyone who guesses the URL
could see it — if you want it harder to find, rename the folder to something random like
`m9k2`, the app works at any path because all links are relative).

> HTTPS is required for the offline/installable features. GitHub Pages provides it — make sure
> "Enforce HTTPS" is on in the repo's Pages settings.

## Add to your iPhone home screen
1. Open the URL in **Safari**.
2. Tap **Share → Add to Home Screen**.
3. Launch it from the icon — it opens fullscreen like a native app and works without signal.

## Daily use
- **Today**: tap *Mark today clean* and *Log a workout*. Tap a day in the 7-day strip to fix a
  missed day. Tap *Beat one* when you resist an urge.
- **Rewards**: claim what you've unlocked (once the fund covers it).
- **Fund**: log found money each week.
- **More**: settings, history, and **export a backup** now and then (data is per-device).

## Editing
Reward ladders, the weekly workout goal, target, and cap are all editable in the app / in the
`defaults()` block of `index.html`.
