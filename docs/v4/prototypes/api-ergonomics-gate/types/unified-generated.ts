import { define as structural } from "./core";
import { define as executable } from "./generated-app";

export const define = Object.freeze({ ...structural, ...executable });
