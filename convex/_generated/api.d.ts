/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as crons from "../crons.js";
import type * as game from "../game.js";
import type * as http from "../http.js";
import type * as jev from "../jev.js";
import type * as maintenance from "../maintenance.js";
import type * as productEvents from "../productEvents.js";
import type * as product_event_contract from "../product_event_contract.js";
import type * as product_event_validators from "../product_event_validators.js";
import type * as prompts from "../prompts.js";
import type * as rooms from "../rooms.js";
import type * as rubric from "../rubric.js";
import type * as rules from "../rules.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  crons: typeof crons;
  game: typeof game;
  http: typeof http;
  jev: typeof jev;
  maintenance: typeof maintenance;
  productEvents: typeof productEvents;
  product_event_contract: typeof product_event_contract;
  product_event_validators: typeof product_event_validators;
  prompts: typeof prompts;
  rooms: typeof rooms;
  rubric: typeof rubric;
  rules: typeof rules;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
