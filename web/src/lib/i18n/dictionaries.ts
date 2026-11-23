import { common } from "./messages/common";
import { draw } from "./messages/draw";
import { home } from "./messages/home";
import { mint } from "./messages/mint";
import { pages } from "./messages/pages";
import { perps } from "./messages/perps";
import { trade } from "./messages/trade";

/** Every user-facing string, as [English, Simplified Chinese] pairs. */
export const MESSAGES = { ...common, ...home, ...mint, ...draw, ...trade, ...perps, ...pages } as const;
