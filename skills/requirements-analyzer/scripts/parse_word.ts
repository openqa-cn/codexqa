import { parseWord } from "./common_parser.ts";
import { isDirectRun, takeFlag } from "./office_io.ts";

function main(argvIn: string[]): void {
  const argv = [...argvIn];
  const input = takeFlag(argv, "--input");
  if (!input) throw new Error("usage: parse_word.ts --input <file>");
  console.log(parseWord(input));
}

if (isDirectRun(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
