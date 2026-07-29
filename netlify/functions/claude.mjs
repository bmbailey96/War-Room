export default async (req) => {
  const bodyText = await req.text();

  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: bodyText
  });

  const text = await upstream.text();

  if (!upstream.ok) {
    console.error("ANTHROPIC ERROR", upstream.status, text.slice(0, 2000));
    return new Response(
      JSON.stringify({ error: true, status: upstream.status, upstream: text.slice(0, 2000) }),
      { status: upstream.status, headers: { "content-type": "application/json" } }
    );
  }

  return new Response(text, {
    status: 200,
    headers: { "content-type": "application/json" }
  });
};
