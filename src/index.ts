import { handleRequest } from "./handler";

// Only the handler may be exported here: the Workers runtime treats every export
// of the main module as an entry point
export default {
  fetch: (request: Request) => handleRequest(request),
} satisfies ExportedHandler;
