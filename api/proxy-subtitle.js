export const config = {
  runtime: 'edge',
};

function srtToVtt(srtContent) {
  let vtt = 'WEBVTT\n\n';
  let cleaned = srtContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  cleaned = cleaned.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  return vtt + cleaned;
}

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const targetUrl = searchParams.get('url');

  if (!targetUrl || !targetUrl.startsWith('http')) {
    return new Response('Invalid url parameter', { status: 400 });
  }

  try {
    const res = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://movie-box.co/',
        'Accept': '*/*',
      },
    });

    if (!res.ok) {
      return new Response(`Upstream subtitle error: ${res.status}`, { status: res.status });
    }

    const srtText = await res.text();
    const vttText = srtToVtt(srtText);

    return new Response(vttText, {
      status: 200,
      headers: {
        'Content-Type': 'text/vtt; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (err) {
    return new Response('Subtitle proxy error: ' + err.message, { status: 502 });
  }
}
