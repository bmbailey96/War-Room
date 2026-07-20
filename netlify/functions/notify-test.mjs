// Visit /.netlify/functions/notify-test in your browser after setting
// NTFY_TOPIC to confirm the phone connection works.

export default async () => {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) {
    return new Response("NTFY_TOPIC is not set in Netlify environment variables.", { status: 500 });
  }
  const res = await fetch(`https://ntfy.sh/${topic}`, {
    method: "POST",
    headers: { title: "War Room connected", tags: "football,white_check_mark", "content-type": "text/plain" },
    body: "Your phone is wired into The Ocho War Room. Trade alerts, pickup calls, and injury flags will land here.",
  });
  return new Response(res.ok
    ? "Push sent. Check your phone. If nothing arrived, confirm the ntfy app is subscribed to the exact same topic string."
    : `ntfy responded ${res.status}`, { status: res.ok ? 200 : 502 });
};
