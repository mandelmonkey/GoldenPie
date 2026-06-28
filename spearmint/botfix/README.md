# Spearmint bot-fix (`zzz-goldenpie-bots.pk3`)

## Problem

With the stock Quake III bot data, adding bots in Spearmint fails:

```
Warning: couldn't find skill 2 in bots/<name>_c.c
loaded cached default skill 2 from bots/<name>_c.c
Error: couldn't find chat player in bots/daemia_t.c
Fatal: BotLoadChatFile failed
<Bot> BotAISetupPlayer failed
```

So no bots ever spawn.

## Cause

Spearmint's bot setup loads bots at an internal **skill 2**, but the stock character files
(`botfiles/bots/*_c.c`) only define skill blocks **1, 4, 5**. With no skill-2 block, each bot
falls back to the cached **default** character (`default_c.c`), whose chat is configured as:

```
CHARACTERISTIC_CHAT_FILE   "bots/daemia_t.c"
CHARACTERISTIC_CHAT_NAME   "player"
```

…but `daemia_t.c` only contains a `chat "daemia"` section — there is **no `chat "player"`**.
Loading the chat fails fatally, so the bot is dropped.

## Fix

This pk3 ships a single corrected file — `botfiles/bots/default_c.c` — identical to id's original
except `CHARACTERISTIC_CHAT_NAME` is changed from `"player"` to `"daemia"` (a section that *does*
exist in `daemia_t.c`). The fallback chat then loads, and bots spawn normally.

The pk3 is named `zzz-…` so it sorts after `pak0–8` / `spearmint-baseq3-*` and wins the file-lookup
priority. GoldenPie deploys it to `<fs_homepath>/<fs_game>/` on launch (see
`adapters/spearmint-log.js`, `botFixPk3` in `config.json`) — the game install is left untouched.

## Reproducing the pk3

```sh
# extract id's original from the user's paks
unzip -o pak0.pk3 botfiles/bots/default_c.c
# point the fallback chat at a section that exists
sed -i '' 's/"player"/"daemia"/g' botfiles/bots/default_c.c   # only the lowercase chat-name uses it
# repack
zip -r zzz-goldenpie-bots.pk3 botfiles
```

The bot's *chat lines* will be daemia's (cosmetic); aim/movement/skill are unaffected. Bots run at
the skill passed to `addbot <name> <skill>` (1 = "I Can Win", the easiest).
