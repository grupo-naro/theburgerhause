import { prepareDatabase } from "./prepare-db";

prepareDatabase().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
