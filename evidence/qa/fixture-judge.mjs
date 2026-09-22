import { createServer } from "node:http";

const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/decisions") {
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "fixture-route-not-found" }));
    return;
  }
  let text = "";
  for await (const chunk of request) text += chunk;
  const body = JSON.parse(text);
  const questions =
    body && typeof body === "object" && body.questions && typeof body.questions === "object"
      ? body.questions
      : {};
  const answers = Object.fromEntries(
    Object.keys(questions).map((name) => [name, { type: "noul", noul: 0.99 }]),
  );
  response.writeHead(200, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Kindred-QA-Fixture": "identical-answer-judge",
  });
  response.end(JSON.stringify({ answers }));
});

server.listen(3901, "127.0.0.1", () => {
  console.log("FIXTURE ONLY: identical-answer judge listening on 127.0.0.1:3901");
});
