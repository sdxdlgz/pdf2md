declare module "unzipper/lib/parse.js" {
  import type { ParseOptions, ParseStream } from "unzipper";

  const Parse: (opts?: ParseOptions) => ParseStream;
  export default Parse;
}

