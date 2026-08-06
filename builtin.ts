// The themes shipped with nous, embedded in the binary so a fresh install has
// something to draw with. Written into ~/.config/nous/themes/ on first run, and
// any that are missing are written on later runs too, so an upgrade adds new ones
// without ever overwriting an edited file.
//
// They are converted from the swatch palettes of the same names. nous does not
// read swatch at runtime: these files are the whole theme, and they are
// maintained here.

import batmanJazz from "./themes/batman-jazz.toml" with { type: "text" };
import catppuccin from "./themes/catppuccin.toml" with { type: "text" };
import firewatch from "./themes/firewatch.toml" with { type: "text" };
import mafia from "./themes/mafia.toml" with { type: "text" };
import mclaren from "./themes/mclaren.toml" with { type: "text" };
import nightCity from "./themes/night-city.toml" with { type: "text" };
import nord from "./themes/nord.toml" with { type: "text" };
import odyssey from "./themes/odyssey.toml" with { type: "text" };
import seal from "./themes/seal.toml" with { type: "text" };
import spiderVerse from "./themes/spider-verse.toml" with { type: "text" };
import tokyoNight from "./themes/tokyo-night.toml" with { type: "text" };

export const BUILTINS: Record<string, string> = {
  "batman-jazz": batmanJazz as unknown as string,
  "catppuccin": catppuccin as unknown as string,
  "firewatch": firewatch as unknown as string,
  "mafia": mafia as unknown as string,
  "mclaren": mclaren as unknown as string,
  "night-city": nightCity as unknown as string,
  "nord": nord as unknown as string,
  "odyssey": odyssey as unknown as string,
  "seal": seal as unknown as string,
  "spider-verse": spiderVerse as unknown as string,
  "tokyo-night": tokyoNight as unknown as string,
};

export const DEFAULT_THEME = "spider-verse";
