Original prompt: Update the battle timer to 10 minutes and then also make sure that you update the transparent image for Lysander and then also make sure that when a pokemon is knocked out that it is removed from the battle field as I witnessed a pokemon that was knocked out come back to life with life dew and that does not work that way and should make sure that you are implementing the full rulings and parity for the official rulings for the Pokemon Champions game and more. Then i want you to make sure that you update and add about 10 more enhancements and improvements to the game as well. Then make sure that you test and audit everything and fully implement and push to the live server

- Added shared 10-minute match timer constants for Simulator and PvP flows.
- Added battlefield playback guards so heal logs cannot visually revive fainted units.
- Added KO lane-clearing helper so a fainted active Pokemon is removed from the battlefield immediately in presentation playback.
- Added engine-level fainted-target heal prevention in simulator healing flow.
- Added specific audit coverage for Life Dew failing to restore a fainted ally.
- Added dedicated Lysander battlefield asset and switched simulator battlefield background character to use it.
- Reworked simulator intro flow so the preview stage can show Lysander with a dialogue bubble before the battlefield opens.
- Filtered duplicate send-out log playback and delayed automatic AI replacements until playback finishes so turn-end animations do not get cut off.
- Added runtime white-background cleanup for Lysander battlefield / result art so the stage uses a cleaner transparent-looking silhouette.

TODO / follow-up notes:
- Re-run TypeScript, backend audit, build, and browser smoke after the current patch set.
- Push to origin/main once local checks pass.

Verification completed:
- `npx tsc --noEmit` passed.
- `node .\scripts\audit-backend.mjs` passed, including the new Life Dew vs fainted ally audit.
- `npm run build` passed.
- Local browser smoke on `http://127.0.0.1:4174/` passed with 0 console errors.
