import { app } from "@/questpie/server/app";

export const config = {
  app: app,
  cli: {
    migrations: {
      directory: "./src/migrations",
    },
  },
};

export default config;
